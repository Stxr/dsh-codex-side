import { randomUUID } from 'node:crypto';
import { SessionSeq } from '@deepseek-ai/dsh-session';
import { buildForkSeed } from '@deepseek-ai/dsh-session/fork';
import { RESULT, TRANSCRIPT_KEY } from '../shared/protocol.js';
import type { SideResult, TitleGeneration } from '../shared/protocol.js';
import { readRequest } from '../shared/input.js';
import { isTemporary } from '../shared/policy.js';
import { withSideBoundary } from './boundary.js';
import { keyedQueue } from './queue.js';
import { createPolicy } from './policy.js';
import { readTranscript } from './status.js';
import { retitleSide } from './title.js';
import type { AgentHandle, HostAgent, HostContext, Operate, Projection } from './types.js';

export async function createSideService(ctx: HostContext, projection: Projection): Promise<{ operate: Operate }> {
  const handles = new Map<string, AgentHandle>();
  const active = new Map<string, string | null>();
  const enqueue = keyedQueue();
  const policy = createPolicy(ctx, projection);
  const titleLifetime = new AbortController();
  let disposed = false;
  ctx.on('agent/created', ({ agent }) => policy.install(agent));
  for (const agent of ctx.agents.list()) await policy.install(agent);
  ctx.effect(() => async () => {
    disposed = true;
    titleLifetime.abort(new Error('Side plugin unloaded during title generation'));
    for (const handle of handles.values()) await handle.dispose();
    handles.clear();
    await policy.dispose();
  });

  async function sideAgent(parent: HostAgent, id: string): Promise<HostAgent> {
    let agent = ctx.agents.get(id);
    if (!agent) {
      const handle = await ctx.agents.resume({
        resumeSessionId: id,
        setup: async (agentCtx, child) => {
          const state = projection.stateOf(child.session);
          if (state.parentId !== parent.id) throw new Error('旁支会话与当前对话不匹配。');
          await ctx.agentPresets.mount(agentCtx, ctx.agentPresets.presetForSession(child.session) ?? undefined);
          await policy.install(child);
        },
      });
      handles.set(id, handle);
      agent = handle.agent;
    }
    if (projection.stateOf(agent.session).parentId !== parent.id) throw new Error('旁支会话与当前对话不匹配。');
    await policy.install(agent);
    return agent;
  }

  function recordLink(parent: HostAgent, childId: string | null, action: string, extra: { promotedId?: string } = {}): void {
    // 每个已完成子操作有独立原生命令生命周期，后续失败不能抹除已提交状态。
    const commandId = `side-op-${randomUUID()}`;
    parent.session.append('command/run', { commandId, name: 'side', source: { kind: 'user' } });
    parent.session.append('command/done', { commandId, kind: 'success', text: RESULT + JSON.stringify({ ...extra, parentId: parent.id, childId, action }) });
    active.set(parent.id, childId);
  }

  async function detachPermanent(parent: HostAgent, child: HostAgent): Promise<void> {
    // 子会话先持久化，再断开父链接；崩溃或 checkpoint 失败不会误归档永久会话。
    await ctx.sessions.flush(child.session);
    await policy.install(child);
    const state = projection.stateOf(parent.session);
    if (state.childId !== null || state.promotedId !== child.id) recordLink(parent, null, 'keep', { promotedId: child.id });
    else active.set(parent.id, null);
    await ctx.sessions.flush(parent.session);
  }

  async function keep(parent: HostAgent, id: string | null, expectedId: string | undefined, signal?: AbortSignal): Promise<SideResult> {
    const state = projection.stateOf(parent.session);
    if (expectedId && id !== expectedId && (id || state.promotedId !== expectedId)) {
      throw new Error('旁支已变化，请重新打开后再操作。 / The side conversation has changed.');
    }
    const targetId = id ?? state.promotedId;
    if (!targetId) throw new Error('当前没有可转为永久对话的旁支。 / There is no side conversation to keep.');
    const child = await sideAgent(parent, targetId);
    let titleGeneration: TitleGeneration | undefined;
    if (!projection.stateOf(child.session).permanent) {
      const workspaces = ctx.workspaceRegistry.list();
      const parentWorkspace = workspaces.find(workspace => workspace.sessionIds.includes(parent.id));
      // 用户转换当时的分组为准；attach 校验不可变 cwd 后才移除旧分组。
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

  async function close(parent: HostAgent, id: string | null): Promise<void> {
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

  const operate: Operate = async (parent, value, signal) => enqueue(parent.id, async () => {
    signal?.throwIfAborted();
    if (disposed) throw new Error('插件已卸载。 / Plugin is unloaded.');
    const state = projection.stateOf(parent.session);
    if (isTemporary(state)) throw new Error('已在旁支中，请返回主对话后使用 /side。 / Nested side conversations are unavailable.');
    const request = readRequest(value);
    let childId = active.has(parent.id) ? active.get(parent.id) ?? null : state.childId;
    if (request.action === 'status') {
      if (!childId) return { parentId: parent.id, childId: null, action: 'status', running: false, messages: [] };
      const readSignal = signal ?? new AbortController().signal;
      const controller = ctx.get('sessionController');
      const baseline = await controller.projections({ sessionId: childId }, readSignal);
      const status = await controller.state({ sessionId: childId }, readSignal);
      const view = readTranscript(baseline?.values?.[TRANSCRIPT_KEY]);
      return { parentId: parent.id, childId, action: 'status', running: status.running, pendingInput: status.pendingInput, ...view };
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
    let child: HostAgent;
    let created = false;
    if (childId) child = await sideAgent(parent, childId);
    else {
      const events = parent.session.snapshotEvents();
      if (!events.some(event => event.type === 'user/message')) throw new Error('先在主对话发送一条消息，再使用 /side。 / Send a message in the main conversation first.');
      const selection = parent.model.current();
      if (!selection) throw new Error('请先为主对话选择模型。 / Select a model first.');
      const seed = withSideBoundary(buildForkSeed(events, SessionSeq(events.length - 1)), parent.id, randomUUID());
      const id = `side-${randomUUID()}`;
      const preset = ctx.agentPresets.presetForSession(parent.session) ?? undefined;
      const handle = await ctx.agents.create({
        sessionId: id, seed, inheritedEventCount: events.length,
        meta: { cwd: parent.session.header.cwd ?? ctx.workingDirectory.defaultDirectory, isSeeded: true, ...(preset ? { agentPreset: preset } : {}) },
        agentOptions: { ...selection }, signal,
        setup: async (agentCtx, agent) => {
          await ctx.agentPresets.mount(agentCtx, preset);
          agent.inbox.clear();
          agent.model.select(selection);
          await policy.install(agent);
        },
      }).catch(async (error: unknown) => {
        // 工厂回滚可能留下诊断 Session；只归档本次新建的身份。
        try { await ctx.workspaceRegistry.archiveSession(id, { stopActivity: true }); } catch { /* 可能尚未持久化。 */ }
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
  return { operate };
}
