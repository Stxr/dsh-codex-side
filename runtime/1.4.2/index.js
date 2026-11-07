import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { buildForkSeed } from '@deepseek-ai/dsh-session/fork';
import { KEY, TRANSCRIPT_KEY, RESULT, SIDE_POLICY, PERMANENT_POLICY, isTemporary, withSideBoundary, parseInput, initState, initTranscriptState, metadataView, transcriptView, fold, blockSideTool, keyedQueue } from './core.js';
import { installWorkspaceAdapter } from './workspace-adapter.js';
import { retitleSide } from './title.js';

export const inject = ['commands', 'agents', 'sessions', 'sessionProjections', 'tools', 'systemPrompt', 'agentPresets', 'workingDirectory', 'workspaceRegistry', 'webServer', 'clientModules', 'llm', 'sessionTitle'];

export async function apply(ctx) {
  const projection = await ctx.sessionProjections.register({
    key: KEY, stateVersion: 4, stateSchema: z.json(), init: initState, apply: fold,
    wire: { viewSchema: z.json(), summary: true, view: metadataView },
  });
  await ctx.sessionProjections.register({
    key: TRANSCRIPT_KEY, stateVersion: 1, stateSchema: z.json(), init: initTranscriptState, apply: fold,
    wire: { viewSchema: z.json(), summary: false, view: transcriptView },
  });
  if (ctx.webServer && ctx.clientModules) await installWorkspaceAdapter(ctx);
  const handles = new Map();
  const scoped = new Map();
  const active = new Map();
  const enqueue = keyedQueue();
  const titleLifetime = new AbortController();
  let disposed = false;

  async function installPolicy(agent) {
    const state = projection.stateOf(agent.session);
    const mode = isTemporary(state) ? 'side' : state.permanent ? 'permanent' : null;
    const previous = scoped.get(agent);
    if (previous?.mode === mode) return;
    await previous?.dispose();
    if (!mode) return;
    const entry = { mode, dispose: null };
    entry.dispose = agent.ctx.effect(() => {
      // The promotion record is durable. Reassemble this normal-preset notice on
      // resume too, so historical side instructions cannot restore restrictions.
      const prompt = agent.ctx.get('systemPrompt').section({
        name: mode === 'side' ? 'local-codex-side-boundary' : 'local-codex-side-permanent',
        order: mode === 'side' ? 100000 : 100001,
        text: mode === 'side' ? SIDE_POLICY : PERMANENT_POLICY,
      });
      const tools = agent.ctx.get('tools');
      const denied = mode === 'side' ? ctx.tools.schemas().map(t => t.name).filter(blockSideTool) : [];
      const restrict = denied.length ? tools.restrict({ deny: denied }) : () => {};
      const guard = mode === 'side' ? tools.guard(exec => blockSideTool(exec.name) ? 'Side conversations cannot use subagents, worktrees, goals, or scheduled actions. Return to the main conversation.' : undefined) : () => {};
      return () => { guard(); restrict(); prompt(); if (scoped.get(agent) === entry) scoped.delete(agent); };
    });
    scoped.set(agent, entry);
  }
  ctx.on('agent/created', ({ agent }) => installPolicy(agent));
  for (const agent of ctx.agents.list()) await installPolicy(agent);
  ctx.effect(() => async () => {
    disposed = true;
    titleLifetime.abort(new Error('Side plugin unloaded during title generation'));
    for (const handle of handles.values()) await handle.dispose();
    handles.clear();
    for (const entry of scoped.values()) await entry.dispose();
    scoped.clear();
  });

  async function sideAgent(parent, id) {
    let agent = ctx.agents.get(id);
    if (!agent) {
      const handle = await ctx.agents.resume({
        resumeSessionId: id,
        setup: async (agentCtx, child) => {
          const state = projection.stateOf(child.session);
          if (state.parentId !== parent.id) throw new Error('旁支会话与当前对话不匹配。');
          await ctx.agentPresets.mount(agentCtx, ctx.agentPresets.presetForSession(child.session) ?? undefined);
          await installPolicy(child);
        },
      });
      handles.set(id, handle);
      agent = handle.agent;
    }
    if (projection.stateOf(agent.session).parentId !== parent.id) throw new Error('旁支会话与当前对话不匹配。');
    await installPolicy(agent);
    return agent;
  }

  function recordLink(parent, childId, action, extra = {}) {
    // A completed sub-operation has its own ordinary command lifecycle, so cancellation
    // or a later replacement failure cannot erase an already committed transition.
    const commandId = `side-op-${randomUUID()}`;
    parent.session.append('command/run', { commandId, name: 'side', source: { kind: 'user' } });
    parent.session.append('command/done', { commandId, kind: 'success', text: RESULT + JSON.stringify({ ...extra, parentId: parent.id, childId, action }) });
    active.set(parent.id, childId);
  }

  async function detachPermanent(parent, child) {
    // Commit the child first: a stale parent link can never authorize archival
    // after a crash or a failed checkpoint during conversion.
    await ctx.sessions.flush(child.session);
    await installPolicy(child);
    const state = projection.stateOf(parent.session);
    if (state.childId !== null || state.promotedId !== child.id) recordLink(parent, null, 'keep', { promotedId: child.id });
    else active.set(parent.id, null);
    await ctx.sessions.flush(parent.session);
  }

  async function keep(parent, id, expectedId, signal) {
    const state = projection.stateOf(parent.session);
    if (expectedId && id !== expectedId && (id || state.promotedId !== expectedId)) {
      throw new Error('旁支已变化，请重新打开后再操作。 / The side conversation has changed.');
    }
    const targetId = id ?? state.promotedId;
    if (!targetId) throw new Error('当前没有可转为永久对话的旁支。 / There is no side conversation to keep.');
    const child = await sideAgent(parent, targetId);
    let titleGeneration;
    if (!projection.stateOf(child.session).permanent) {
      const workspaces = ctx.workspaceRegistry.list();
      const parentWorkspace = workspaces.find(workspace => workspace.sessionIds.includes(parent.id));
      // Membership is chosen at the user's conversion, never inferred from cwd.
      // Attach validates the immutable cwd before any old membership is removed.
      if (parentWorkspace) await parentWorkspace.attachSession(child.id);
      for (const workspace of workspaces) {
        if (workspace.id !== parentWorkspace?.id && workspace.sessionIds.includes(child.id)) await workspace.detachSession(child.id);
      }
      titleGeneration = await retitleSide(ctx, child, AbortSignal.any([titleLifetime.signal, ...(signal ? [signal] : [])]));
      recordLink(child, null, 'promoted');
    }
    await detachPermanent(parent, child);
    return { parentId: parent.id, childId: null, action: 'keep', promotedId: child.id, permanent: true, ...(titleGeneration ? { titleGeneration } : {}) };
  }

  async function close(parent, id) {
    if (!id) return;
    const child = await sideAgent(parent, id);
    if (projection.stateOf(child.session).permanent) { await detachPermanent(parent, child); return; }
    await ctx.workspaceRegistry.archiveSession(child.id, { stopActivity: true });
    try {
      recordLink(parent, null, 'close');
      await ctx.sessions.flush(parent.session);
    } finally {
      const handle = handles.get(id);
      if (handle) { await handle.dispose(); handles.delete(id); }
    }
  }

  async function operate(parent, request, signal) {
    return enqueue(parent.id, async () => {
      signal?.throwIfAborted();
      if (disposed) throw new Error('插件已卸载。 / Plugin is unloaded.');
      const state = projection.stateOf(parent.session);
      if (isTemporary(state)) throw new Error('已在旁支中，请返回主对话后使用 /side。 / Nested side conversations are unavailable.');
      let childId = active.has(parent.id) ? active.get(parent.id) : state.childId;
      if (request.action === 'status') {
        if (!childId) return { parentId: parent.id, childId: null, action: 'status', running: false, messages: [] };
        const readSignal = signal ?? new AbortController().signal;
        const controller = ctx.get('sessionController');
        const baseline = await controller.projections({ sessionId: childId }, readSignal);
        const status = await controller.state({ sessionId: childId }, readSignal);
        const view = baseline?.values?.[TRANSCRIPT_KEY];
        const messages = (view?.messages ?? []).slice(-4).map(message => ({ ...message, text: message.text.slice(0, 6000), truncated: message.truncated || message.text.length > 6000 }));
        return { parentId: parent.id, childId, action: 'status', running: status.running, pendingInput: status.pendingInput, messages, ended: view?.ended ?? null };
      }
      if (request.action === 'keep') return keep(parent, childId, request.childId, signal);
      if (childId) {
        const candidate = await sideAgent(parent, childId);
        if (projection.stateOf(candidate.session).permanent) {
          await detachPermanent(parent, candidate);
          childId = null;
        }
      }
      if (request.action === 'stop') {
        if (childId) (await sideAgent(parent, childId)).cancel({ kind: 'user' });
        return { parentId: parent.id, childId, action: 'stop' };
      }
      if (request.action === 'close' || request.action === 'new') {
        await close(parent, childId);
        childId = null;
        active.set(parent.id, null);
        if (request.action === 'close') return { parentId: parent.id, childId: null, action: 'close' };
      }
      let child;
      let created = false;
      if (childId) child = await sideAgent(parent, childId);
      else {
        const events = parent.session.snapshotEvents();
        if (!events.some(e => e.type === 'user/message')) throw new Error('先在主对话发送一条消息，再使用 /side。 / Send a message in the main conversation first.');
        const selection = parent.model.current();
        if (!selection) throw new Error('请先为主对话选择模型。 / Select a model first.');
        const seed = withSideBoundary(buildForkSeed(events, events.length - 1), parent.id, randomUUID());
        const id = `side-${randomUUID()}`;
        const preset = ctx.agentPresets.presetForSession(parent.session) ?? undefined;
        const handle = await ctx.agents.create({
          sessionId: id, seed, inheritedEventCount: events.length,
          meta: { cwd: parent.session.header.cwd ?? ctx.workingDirectory.defaultDirectory, isSeeded: true, ...(preset ? { agentPreset: preset } : {}) },
          agentOptions: { ...selection }, signal,
          setup: async (agentCtx, agent) => {
            await ctx.agentPresets.mount(agentCtx, preset);
            // Inherited queued prompts are reference history, never work for this child.
            agent.inbox.clear();
            agent.model.select(selection);
            await installPolicy(agent);
          },
        }).catch(async error => {
          // The factory can retain a diagnostic Session after rollback. Archive only
          // this newly minted identity; never leave a failed side in the active list.
          try { await ctx.workspaceRegistry.archiveSession(id, { stopActivity: true }); } catch { /* Creation may have failed before persistence. */ }
          throw error;
        });
        handles.set(id, handle);
        child = handle.agent;
        childId = id;
        created = true;
        try {
          await ctx.sessions.flush(child.session);
          recordLink(parent, id, 'open');
          await ctx.sessions.flush(parent.session);
        } catch (error) {
          await ctx.workspaceRegistry.archiveSession(id, { stopActivity: true });
          await handle.dispose();
          handles.delete(id);
          recordLink(parent, null, 'close');
          throw error;
        }
      }
      try {
        signal?.throwIfAborted();
        if (request.question) child.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: request.question }], source: { kind: 'user' } });
      } catch (error) {
        if (created) await close(parent, childId);
        throw error;
      }
      return { parentId: parent.id, childId, action: request.action, created };
    });
  }
  ctx.provide('codexSide', { operate });
  ctx.commands.register({
    name: 'side', definitionId: '@local/dsh-codex-side:side',
    description: '旁支对话：继承上下文提问，主任务继续 / Ask in a side conversation',
    input: { hint: '[问题 / question] | --new [question] | --keep | --close | --stop | --status' },
    handler: async ({ agent, rawInput, signal }) => {
      try {
        const result = await operate(agent, parseInput(rawInput), signal);
        return { kind: 'success', text: RESULT + JSON.stringify(result) };
      } catch (error) { return { kind: 'error', text: error instanceof Error ? error.message : String(error) }; }
    },
  });
  ctx.tools.register({
    name: 'side_conversation',
    description: 'Open, ask in, inspect, stop, or close a side conversation that inherits the current context. Replies stay in that conversation; status returns its recent messages. Closing stops and archives it.',
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['open', 'ask', 'new', 'close', 'stop', 'status'] },
      question: { type: 'string', description: 'Question for ask; optional opening question for open or new.' },
    }, required: ['action'], additionalProperties: false },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('An active conversation is required.');
      if (!args || !['open', 'ask', 'new', 'close', 'stop', 'status'].includes(args.action)) throw new Error('Invalid side action.');
      if (args.action === 'ask' && !args.question?.trim()) throw new Error('A question is required for ask.');
      const line = args.action === 'new' ? `/side --new ${args.question ?? ''}`
        : args.action === 'close' ? '/side --close' : args.action === 'stop' ? '/side --stop' : args.action === 'status' ? '/side --status'
        : args.question?.trim() ? `/side --ask ${args.question}` : '/side';
      const execution = await ctx.commands.execute(exec.agent, line, [], exec.signal);
      if (!execution || execution.result.kind === 'error') throw new Error(execution?.result.text ?? 'Side command unavailable.');
      const { decodeResult } = await import('./core.js');
      return decodeResult(execution.result.text);
    },
  });
}
