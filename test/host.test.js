import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Session, SESSION_FORMAT_VERSION, KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session';
import { releasedV4SessionFormatCodec, restoreReleasedV4Artifact } from '@deepseek-ai/dsh-session-format-v3-to-v4';
import { apply } from '../index.js';
import { KEY, TRANSCRIPT_KEY, MARKER, SIDE_POLICY, PERMANENT_POLICY, decodeResult, isTemporary } from '../core.js';

// The plugin and fork/surface validation are real. The Agent factory, projection
// registry, title model and persistence checkpoints below are deliberately small
// test doubles; no provider I/O, real archive operation or installed profile is involved.
const text = value => [{ type: 'text', text: value }];
const user = value => ({ id: randomUUID(), role: 'user', content: text(value), source: { kind: 'user' } });
const readInbox = session => {
  const state = { 'next-turn': [], 'next-step': [] };
  for (const event of session.snapshotEvents()) {
    if (event.type !== 'agent/inbox/spliced') continue;
    const d = event.data;
    state[d.target].splice(d.start, d.removedCount ?? 0, ...d.inserted);
  }
  return state;
};

// Record the native admission and lifecycle events for a human input, with no
// generated assistant response or title request added to conversation history.
function admitQuestion(agent, question, surfaceOp = 'append') {
  const session = agent.session;
  const message = typeof question === 'string' ? user(question) : question;
  const turn = Math.max(0, ...session.snapshotEvents().filter(event => event.type === 'turn/start').map(event => event.data.turn)) + 1;
  session.append('turn/start', { turn });
  for (const target of ['next-turn', 'next-step']) {
    const index = readInbox(session)[target].findIndex(pending => pending.id === message.id);
    if (index !== -1) session.append('agent/inbox/spliced', { target, start: index, removedCount: 1, inserted: [] });
  }
  const event = session.append('user/message', message, { surfaceOp });
  session.append('step/start', { turn, step: 1 });
  session.append('step/end', { turn, step: 1 });
  session.append('turn/end', { turn, reason: { kind: 'completed' } });
  return event;
}

// Exercise the actual persistence writer, strict reader and native V4 lifecycle
// restorer. Session.fromRestore alone does not enforce turn/step relationships.
function nativeRoundTrip(session, events = session.snapshotEvents()) {
  const codec = releasedV4SessionFormatCodec;
  const headerRow = JSON.parse(JSON.stringify(codec.encodeHeader(session.header, session.inheritedEventCount)));
  const decoder = codec.createDecoder(headerRow, 'strict');
  const decoded = [];
  const context = {
    emitEvent(event) { decoded.push(event); },
    emitRun(run) { decoded.push(...run.expand()); },
  };
  for (const event of events) decoder.decodeRow(JSON.parse(JSON.stringify(codec.encodeEvent(event))), context);
  const inheritedEventCount = decoder.finish(context);
  return restoreReleasedV4Artifact({ header: decoder.header, inheritedEventCount, events: decoded }, KNOWN_SESSION_EVENT_TYPES);
}

async function fixture(t) {
  const live = new Map();
  const stored = new Map();
  const listeners = new Map();
  const cleanups = [];
  const created = [];
  const archived = [];
  const flushed = [];
  const projections = new Map();
  const workspaces = [];
  const membership = new Map();
  const attachments = [];
  const titleCalls = [];
  const titleRequests = [];
  const renameCalls = [];
  const control = {
    createError: null, mountError: null, flushFailure: null, beforeCreate: null, beforeAttach: null,
    titleText: '旁支新标题', titleError: null, beforeTitle: null,
  };
  const sessionTitle = {
    get(session) {
      const event = session.snapshotEvents().findLast(event => event.type === 'session/title');
      return event ? { ...event.data, eventSeq: event.seq, updatedAt: event.time } : undefined;
    },
    rename(session, value) {
      const title = value.replace(/\s+/gu, ' ').trim();
      assert.ok(title, 'native rename requires a nonempty normalized title');
      renameCalls.push({ session, title: value });
      session.append('session/title', { title, source: { kind: 'user' }, messageSeqs: [] });
      return sessionTitle.get(session);
    },
  };
  const llm = {
    async prepareCall(config, signal, selector) {
      signal?.throwIfAborted();
      const { provider, model, ...controls } = config;
      const modelInfo = {
        provider, id: model, name: model,
        reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' },
      };
      const selected = selector ? selector(controls, modelInfo) : controls;
      const resolved = { provider, model, ...selected };
      titleCalls.push({ config, signal, selector, selected, resolved });
      return {
        config: resolved,
        async *stream(options) {
          titleRequests.push(options);
          await control.beforeTitle?.(options);
          options.signal?.throwIfAborted();
          if (control.titleError) throw control.titleError;
          const title = control.titleText;
          yield { type: 'block-start', blockType: 'text', index: 0 };
          yield { type: 'text-delta', text: title, index: 0 };
          yield { type: 'block-end', index: 0, block: { type: 'text', text: title } };
          yield { type: 'finish', reason: { kind: 'stop' } };
        },
      };
    },
  };
  let projection;

  function moveSession(sessionId, workspaceId = null) {
    for (const ids of membership.values()) ids.delete(sessionId);
    if (workspaceId !== null) {
      assert.ok(membership.has(workspaceId), `Unknown fixture workspace: ${workspaceId}`);
      membership.get(workspaceId).add(sessionId);
    }
  }

  function addWorkspace(id, sessionIds = [], path = `/${id}`) {
    membership.set(id, new Set());
    const workspace = {
      id, path, title: id, attachError: null,
      get sessionIds() { return Object.freeze([...membership.get(id)]); },
      async attachSession(sessionId) {
        attachments.push({ workspaceId: id, sessionId });
        await control.beforeAttach?.(workspace, sessionId);
        if (workspace.attachError) throw workspace.attachError;
        moveSession(sessionId, id);
      },
    };
    workspaces.push(workspace);
    for (const sessionId of sessionIds) moveSession(sessionId, id);
    return workspace;
  }
  let service;
  let command;
  const registeredTools = [{ name: 'subagent' }, { name: 'bash' }];

  function makeAgent(session, selection = { provider: 'test', model: 'test-model' }) {
    const effects = [];
    const policies = { prompts: new Set(), guards: new Set(), restrictions: new Set() };
    const agent = {
      id: session.id, session, status: 'running', disposed: false,
      // Mirrors the real loop's construction-time lastTurn cache, before setup.
      initialLastTurn: Math.max(0, ...session.snapshotEvents().filter(e => e.type === 'turn/start').map(e => e.data.turn)),
      followups: [], cancellations: [], policies,
      model: { current: () => ({ ...selection }), select: value => { selection = { ...value }; } },
      inbox: {
        get nextTurn() { return readInbox(session)['next-turn']; },
        get nextStep() { return readInbox(session)['next-step']; },
        clear() {
          for (const target of ['next-step', 'next-turn']) {
            const removedCount = readInbox(session)[target].length;
            if (removedCount) session.append('agent/inbox/spliced', { target, start: 0, removedCount, inserted: [], outcome: 'canceled' });
          }
        },
      },
      followup(message) {
        if (agent.disposed) throw new Error('Agent is disposed');
        assert.equal(message.role, 'user', 'followup must receive an already complete UserMessage');
        assert.equal(typeof message.id, 'string', 'followup must receive a producer-assigned message id');
        assert.ok(message.id.length > 0, 'followup message id must be nonempty');
        assert.equal(message.source?.kind, 'user');
        assert.ok(Array.isArray(message.content));
        agent.followups.push(message);
        // The real loop forwards this message unchanged; never repair its shape here.
        session.append('agent/inbox/spliced', { target: 'next-turn', start: agent.inbox.nextTurn.length, inserted: [message] });
      },
      cancel(cause) { agent.cancellations.push(cause); agent.inbox.clear(); agent.status = 'idle'; },
      ctx: {
        effect(callback) {
          const cleanup = callback();
          let active = true;
          const dispose = () => { if (!active) return; active = false; return cleanup?.(); };
          effects.push(dispose);
          return dispose;
        },
        get(name) {
          const register = (set, value) => { set.add(value); return () => set.delete(value); };
          if (name === 'systemPrompt') return { section: value => register(policies.prompts, value) };
          if (name === 'tools') return {
            schemas: () => registeredTools,
            restrict: value => register(policies.restrictions, value),
            guard: value => register(policies.guards, value),
          };
          throw new Error(`Unexpected agent service: ${name}`);
        },
      },
    };
    const handle = { agent, async dispose() {
      if (agent.disposed) return;
      agent.disposed = true;
      for (const dispose of effects) await dispose();
      if (live.get(agent.id) === agent) live.delete(agent.id);
    } };
    return handle;
  }

  const parentSession = Session.create('main', undefined, {
    version: SESSION_FORMAT_VERSION, id: 'main', createdAt: Date.now(), cwd: '/original-workspace', isSeeded: false, delegationDepth: 0,
  });
  parentSession.append('turn/start', { turn: 1 });
  parentSession.append('step/start', { turn: 1, step: 1 });
  parentSession.append('system/message', {
    turn: 1, step: 1,
    message: { id: randomUUID(), role: 'system', source: { kind: 'system-prompt' }, content: text('Main conversation instructions') },
  }, { surfaceOp: 'append' });
  parentSession.append('user/message', user('Continue the main task'), { surfaceOp: 'append' });
  parentSession.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [user('Queued inherited task')] });
  parentSession.append('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [user('Inherited steering')] });
  const parentHandle = makeAgent(parentSession);
  const parent = parentHandle.agent;
  live.set(parent.id, parent);
  stored.set(parent.id, parentSession);

  const controller = {
    async projections({ sessionId }, signal) {
      signal?.throwIfAborted();
      const session = stored.get(sessionId);
      if (!session) return null;
      return { kind: 'sequenced', asOfSeq: session.seq - 1,
        values: Object.fromEntries([...projections].filter(([, handle]) => handle.definition.wire).map(([key, handle]) =>
          [key, handle.definition.wire.view(handle.stateOf(session))])),
      };
    },
    async state({ sessionId }, signal) {
      signal?.throwIfAborted();
      const agent = live.get(sessionId);
      return { cursor: stored.get(sessionId).seq - 1, active: Boolean(agent), running: agent?.status === 'running', queue: null, pendingInput: [] };
    },
  };
  const ctx = {
    get: name => ({ sessionController: controller, llm, sessionTitle })[name],
    llm,
    sessionTitle,
    sessionProjections: {
      async register(definition) {
        assert.equal(projections.has(definition.key), false, 'projection keys must be unique');
        const handle = {
          definition,
          stateOf(session) { return session.snapshotEvents().reduce(definition.apply, definition.init(session.header, session.inheritedEventCount)); },
        };
        projections.set(definition.key, handle);
        if (definition.key === KEY) projection = handle;
        return handle;
      },
    },
    on(name, callback) { const callbacks = listeners.get(name) ?? []; callbacks.push(callback); listeners.set(name, callbacks); },
    effect(callback) { const cleanup = callback(); cleanups.push(cleanup); return cleanup; },
    provide(name, value) { assert.equal(name, 'codexSide'); service = value; },
    agents: {
      list: () => [...live.values()],
      get: id => live.get(id),
      turnBoundaryOf: session => ({ lastTurn: Math.max(0, ...session.snapshotEvents().filter(e => e.type === 'turn/start').map(e => e.data.turn)) }),
      async create(options) {
        await control.beforeCreate?.(options);
        if (control.createError) throw control.createError;
        const session = Session.create(options.sessionId, options.seed, {
          version: SESSION_FORMAT_VERSION, id: options.sessionId, createdAt: Date.now(), delegationDepth: 0, ...options.meta,
        }, options.inheritedEventCount);
        stored.set(session.id, session);
        const handle = makeAgent(session, options.agentOptions);
        created.push({ options, handle, copiedInbox: readInbox(session) });
        try {
          await options.setup?.(handle.agent.ctx, handle.agent);
          live.set(session.id, handle.agent);
          for (const listener of listeners.get('agent/created') ?? []) await listener({ agent: handle.agent, source: 'startup' });
          return handle;
        } catch (error) {
          await handle.dispose();
          throw error;
        }
      },
      async resume(options) {
        const original = stored.get(options.resumeSessionId);
        if (!original) throw new Error('Missing persisted child');
        const restored = Session.fromRestore(original.id, original.snapshotEvents(), original.header, original.inheritedEventCount, 'shared-frozen');
        stored.set(restored.id, restored);
        const handle = makeAgent(restored);
        try {
          await options.setup?.(handle.agent.ctx, handle.agent);
          live.set(restored.id, handle.agent);
          for (const listener of listeners.get('agent/created') ?? []) await listener({ agent: handle.agent, source: 'resume' });
          return handle;
        } catch (error) { await handle.dispose(); throw error; }
      },
    },
    agentPresets: {
      presetForSession: () => 'standard',
      async mount() { if (control.mountError) throw control.mountError; },
    },
    workingDirectory: { get: () => '/different-current-directory', defaultDirectory: '/fallback' },
    sessions: { async flush(session) { flushed.push(session.id); await control.flushFailure?.(session); } },
    workspaceRegistry: {
      list: () => [...workspaces],
      get: id => workspaces.find(workspace => workspace.id === id),
      async archiveSession(id, options) {
        archived.push({ id, options });
        if (options.stopActivity) live.get(id)?.cancel({ kind: 'user' });
      },
    },
    tools: { schemas: () => registeredTools, register(definition) { registeredTools.push(definition); } },
    commands: { register(definition) { command = definition; } },
  };
  await apply(ctx);
  t.after(async () => { for (const cleanup of cleanups.reverse()) await cleanup?.(); await parentHandle.dispose(); });
  return { ctx, parent, created, archived, flushed, control, live, stored, projection, projections,
    titleCalls, titleRequests, renameCalls,
    transcript: projections.get(TRANSCRIPT_KEY), workspaces, attachments, addWorkspace, moveSession,
    operate: (request, signal, agent = parent) => service.operate(agent, request, signal),
    command: (rawInput, signal = new AbortController().signal) => command.handler({ agent: parent, rawInput, signal }),
  };
}

test('actual open inherits a stable prefix, clears copied input, validates boundary, and preserves main activity', async t => {
  const f = await fixture(t);
  const before = f.parent.session.snapshotEvents();
  const pending = readInbox(f.parent.session);
  const result = await f.operate({ action: 'open' });
  const child = f.live.get(result.childId);
  assert.ok(result.created);
  assert.deepEqual(child.session.snapshotEvents().slice(0, before.length), before);
  assert.equal(child.session.inheritedEventCount, before.length);
  assert.equal(child.session.header.cwd, f.parent.session.header.cwd, 'cwd changes must not widen the inherited permission root');
  assert.equal(f.created[0].copiedInbox['next-turn'].length, 1);
  assert.equal(f.created[0].copiedInbox['next-step'].length, 1);
  assert.deepEqual(readInbox(child.session), { 'next-turn': [], 'next-step': [] });
  assert.deepEqual(child.followups, [], 'opening alone must not execute inherited work');
  const boundary = child.session.ownEvents().find(e => e.type === 'developer/message' && e.data.message.content[0].text.startsWith(MARKER));
  assert.ok(boundary);
  assert.deepEqual(boundary.data.message.source, { kind: 'local-codex-side' }, 'the persistence format requires a producer-owned developer source');
  assert.ok(Number.isInteger(boundary.data.turn) && boundary.data.turn >= 1, 'persistence requires a positive developer turn');
  assert.ok(Number.isInteger(boundary.data.step) && boundary.data.step >= 1, 'persistence requires a positive developer step');
  assert.equal(f.projection.stateOf(child.session).parentId, f.parent.id);
  assert.ok(child.session.ownEvents().some(e => e.type === 'turn/end' && e.data.reason.kind === 'forked'));
  assert.doesNotThrow(() => Session.fromRestore(child.id, child.session.snapshotEvents(), child.session.header, child.session.inheritedEventCount, 'shared-frozen').deriveMessages());
  assert.deepEqual(f.parent.session.snapshotEvents().slice(0, before.length), before);
  assert.ok(f.parent.session.snapshotEvents().slice(before.length).every(e => e.type === 'command/run' || e.type === 'command/done'));
  assert.deepEqual(readInbox(f.parent.session), pending);
  assert.equal(f.parent.status, 'running');
  assert.deepEqual(f.parent.cancellations, []);
});

test('multiple questions reuse one side and only enqueue the submitted questions', async t => {
  const f = await fixture(t);
  const first = await f.operate({ action: 'ask', question: 'Explain the current task' });
  const second = await f.operate({ action: 'ask', question: 'Why that approach?' });
  assert.equal(second.childId, first.childId);
  assert.equal(f.created.length, 1);
  const child = f.live.get(first.childId);
  assert.deepEqual(child.inbox.nextTurn.map(m => m.content[0].text), ['Explain the current task', 'Why that approach?']);
  assert.deepEqual(child.inbox.nextStep, []);
  assert.deepEqual(f.parent.cancellations, []);
});

test('close archives and disposes only the side, committing a replayable null link', async t => {
  const f = await fixture(t);
  const opened = await f.operate({ action: 'ask', question: 'A side question' });
  const child = f.live.get(opened.childId);
  await f.operate({ action: 'close' });
  assert.deepEqual(f.archived, [{ id: child.id, options: { stopActivity: true } }]);
  assert.equal(child.disposed, true);
  assert.equal(f.live.has(child.id), false);
  assert.equal(child.policies.guards.size, 0);
  assert.equal(f.projection.stateOf(f.parent.session).childId, null);
  assert.equal((await f.operate({ action: 'status' })).childId, null);
  assert.equal(f.parent.status, 'running');
  assert.deepEqual(f.parent.cancellations, []);
});

test('factory and setup failures publish no active side or parent link', async t => {
  for (const point of ['createError', 'mountError']) {
    await t.test(point, async t => {
      const f = await fixture(t);
      f.control[point] = new Error(`injected ${point}`);
      await assert.rejects(f.operate({ action: 'ask', question: 'Do not lose this' }), /injected/);
      assert.deepEqual([...f.live.keys()], ['main']);
      assert.equal(f.projection.stateOf(f.parent.session).childId, null);
      assert.equal((await f.operate({ action: 'status' })).childId, null);
      assert.deepEqual(f.parent.cancellations, []);
      assert.ok(f.created.every(({ handle }) => handle.agent.disposed));
    });
  }
});

test('child and parent creation-checkpoint failures archive/dispose the new side and clear its link', async t => {
  for (const failingId of ['child', 'main']) {
    await t.test(failingId, async t => {
      const f = await fixture(t);
      f.control.flushFailure = session => { if ((session.id === 'main') === (failingId === 'main')) throw new Error('injected flush failure'); };
      await assert.rejects(f.operate({ action: 'ask', question: 'Never start after failed setup' }), /injected flush failure/);
      const child = f.created[0].handle.agent;
      assert.equal(child.disposed, true);
      assert.deepEqual(child.followups, []);
      assert.deepEqual(f.archived, [{ id: child.id, options: { stopActivity: true } }]);
      assert.equal(f.projection.stateOf(f.parent.session).childId, null);
      assert.equal((await f.operate({ action: 'status' })).childId, null);
      assert.deepEqual(f.parent.cancellations, []);
    });
  }
});

test('failed --new keeps the already closed transition durable', async t => {
  const f = await fixture(t);
  const previous = await f.operate({ action: 'open' });
  f.control.createError = new Error('replacement cannot start');
  const outcome = await f.command('--new replacement question');
  assert.equal(outcome.kind, 'error');
  assert.match(outcome.text, /replacement cannot start/);
  assert.equal(f.live.has(previous.childId), false);
  assert.equal(f.projection.stateOf(f.parent.session).childId, null);
  assert.equal((await f.operate({ action: 'status' })).childId, null);
});

test('concurrent opens serialize creation and return the same child', async t => {
  const f = await fixture(t);
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  f.control.beforeCreate = () => barrier;
  const first = f.operate({ action: 'ask', question: 'first' });
  const second = f.operate({ action: 'ask', question: 'second' });
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.childId, b.childId);
  assert.equal(f.created.length, 1);
  assert.deepEqual(f.live.get(a.childId).followups.map(m => m.content[0].text), ['first', 'second']);
});

test('resuming the same side id reapplies policy to the exact replacement Agent', async t => {
  const f = await fixture(t);
  const opened = await f.operate({ action: 'open' });
  const original = f.created[0].handle;
  assert.equal(original.agent.policies.guards.size, 1);
  await original.dispose();
  await f.operate({ action: 'ask', question: 'Question after replacement' });
  const replacement = f.live.get(opened.childId);
  assert.notEqual(replacement, original.agent);
  assert.equal(replacement.policies.guards.size, 1);
  assert.equal(replacement.policies.prompts.size, 1);
  assert.ok([...replacement.policies.guards][0]({ name: 'subagent' }));
  assert.equal([...replacement.policies.guards][0]({ name: 'read' }), undefined);
});

test('native V4 codec restores the seeded boundary and the first new question without repeating its turn', async t => {
  const f = await fixture(t);
  const opened = await f.operate({ action: 'open' });
  const child = f.live.get(opened.childId);
  const constructionSeed = f.created[0].options.seed;
  const seededBoundary = constructionSeed.find(event => event.type === 'developer/message' && event.data.message.content[0].text.startsWith(MARKER));
  assert.ok(seededBoundary, 'the boundary transaction must be seeded before the loop caches its last turn');
  assert.equal(child.initialLastTurn, seededBoundary.data.turn);
  assert.doesNotThrow(() => nativeRoundTrip(child.session, constructionSeed), 'native cold restore must accept the construction seed');
  const artifact = nativeRoundTrip(child.session);
  assert.equal(artifact.inheritedEventCount, f.created[0].options.inheritedEventCount);

  await f.operate({ action: 'ask', question: 'The first actual side question' });
  const pending = child.inbox.nextTurn;
  assert.equal(pending.length, 1);
  // Drive only the normal durable admission/close events, without a model request.
  // The real loop increments the counter captured before setup, not a fresh scan.
  const turn = child.initialLastTurn + 1;
  const firstQuestionStart = child.session.seq;
  child.session.append('turn/start', { turn });
  child.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] });
  child.session.append('user/message', pending[0], { surfaceOp: 'append' });
  child.session.append('step/start', { turn, step: 1 });
  child.session.append('step/end', { turn, step: 1 });
  child.session.append('turn/end', { turn, reason: { kind: 'completed' } });
  const restored = nativeRoundTrip(child.session);
  assert.ok(restored.events.some(event => event.type === 'user/message' && event.data.content[0].text === 'The first actual side question'));
  const duplicatedTurn = {
    ...restored,
    events: restored.events.map(event => event.seq === firstQuestionStart ? { ...event, data: { turn: seededBoundary.data.turn } } : event),
  };
  assert.throws(() => restoreReleasedV4Artifact(duplicatedTurn, KNOWN_SESSION_EVENT_TYPES), /turn\/start does not open the expected turn/);
});

test('one human side command produces one reveal while internal checkpoints stay durable', async t => {
  const f = await fixture(t);
  let invocation = 0;
  async function execute(rawInput) {
    const commandId = `human-command-${++invocation}`;
    const before = f.projection.stateOf(f.parent.session).revision;
    f.parent.session.append('command/run', { commandId, name: 'side', source: { kind: 'user' } });
    const result = await f.command(rawInput);
    assert.equal(result.kind, 'success', result.text);
    assert.equal(f.projection.stateOf(f.parent.session).revision, before, 'internal child/link commits cannot reveal the sidebar');
    f.parent.session.append('command/done', { commandId, kind: result.kind, text: result.text });
    assert.equal(f.projection.stateOf(f.parent.session).revision, before + 1, 'the completed human invocation reveals exactly once');
    return decodeResult(result.text);
  }
  const first = await execute('');
  assert.equal(f.projection.stateOf(f.parent.session).childId, first.childId);
  assert.equal((await execute('')).childId, first.childId, 'reopening still reveals once without making a second child');
  const replacement = await execute('--new Another question');
  assert.notEqual(replacement.childId, first.childId);
  assert.equal(f.created.length, 2);
  assert.equal(f.projection.stateOf(f.parent.session).revision, 3);
  assert.ok(f.parent.session.ownEvents().some(event => event.type === 'command/run' && event.data.commandId.startsWith('side-op-')), 'recovery checkpoints remain in the log');
});

test('projection version 4 recomputes reveal state and preserves permanent-sidebar fields', async t => {
  const f = await fixture(t);
  assert.equal(f.projection.definition.key, KEY);
  assert.equal(f.projection.definition.stateVersion, 4);
  const initial = f.projection.stateOf(f.parent.session);
  assert.equal(initial.permanent, false);
  assert.equal(initial.promotedId, null);
});

test('the original projection is summary metadata only and accepts cached version 4 states', async t => {
  const f = await fixture(t);
  const definition = f.projection.definition;
  assert.equal(definition.key, 'local.codexSide.v1');
  assert.equal(definition.stateVersion, 4, 'existing cached checkpoint metadata must remain eligible');
  assert.equal(definition.wire.summary, true);
  const cached = {
    sessionId: 'cached-side', inheritedEventCount: 40, parentId: 'cached-main', childId: null,
    permanent: false, promotedId: null, revision: 2, error: null, sideCommands: [],
    messages: [{ id: 'cached-message', role: 'assistant', text: 'Do not publish this transcript in the native list' }],
    boundary: 40, ended: 'completed',
  };
  const parsed = definition.stateSchema.parse(cached);
  assert.deepEqual(definition.wire.view(parsed), {
    sessionId: 'cached-side', parentId: 'cached-main', childId: null, permanent: false,
    promotedId: null, revision: 2, error: null, ended: 'completed',
  });
  const opened = await f.operate({ action: 'open' });
  const child = f.live.get(opened.childId);
  const view = definition.wire.view(f.projection.stateOf(child.session));
  assert.deepEqual(view, {
    sessionId: child.id, parentId: f.parent.id, childId: null, permanent: false,
    promotedId: null, revision: 0, error: null, ended: 'completed',
  });
  assert.equal(Object.hasOwn(view, 'messages'), false);
  assert.equal(Object.hasOwn(view, 'sideCommands'), false);
  assert.equal(Object.hasOwn(view, 'boundary'), false);
  const outcome = await f.command('--keep');
  assert.equal(outcome.kind, 'success', outcome.text);
  assert.equal(definition.wire.view(f.projection.stateOf(child.session)).permanent, true);
});

test('the separate non-summary transcript bounds stored messages and supplies status without resuming the child', async t => {
  const f = await fixture(t);
  assert.equal(f.projections.size, 2);
  assert.equal(f.projection, f.projections.get(KEY), 'existing fixture callers retain the main projection');
  assert.ok(f.transcript);
  assert.equal(f.transcript.definition.key, TRANSCRIPT_KEY);
  assert.equal(f.transcript.definition.wire.summary, false);
  const opened = await f.operate({ action: 'open' });
  const child = f.live.get(opened.childId);
  assert.deepEqual(f.transcript.stateOf(child.session).messages, [], 'inherited main history is not side output');
  for (let i = 0; i < 6; i++) {
    const turn = child.initialLastTurn + i + 1;
    child.session.append('turn/start', { turn });
    child.session.append('user/message', user(`Question ${i}`), { surfaceOp: 'append' });
    child.session.append('step/start', { turn, step: 1 });
    child.session.append('assistant/message', {
      turn, step: 1, stream: [], message: {
        id: randomUUID(), role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test-model' },
        content: text(i === 5 ? 'a'.repeat(6001) : `Answer ${i}`),
      },
    }, { surfaceOp: 'append' });
    child.session.append('step/end', { turn, step: 1 });
    child.session.append('turn/end', { turn, reason: { kind: 'completed' } });
    assert.ok(f.transcript.stateOf(child.session).messages.length <= 4);
  }
  const state = f.transcript.stateOf(child.session);
  const view = f.transcript.definition.wire.view(state);
  assert.deepEqual(state.messages.map(message => message.text), ['Question 4', 'Answer 4', 'Question 5', 'a'.repeat(6001)]);
  assert.deepEqual(view.messages.map(message => message.text), ['Question 4', 'Answer 4', 'Question 5', 'a'.repeat(6000)]);
  assert.deepEqual(view.messages.map(message => message.truncated), [false, false, false, true]);
  assert.equal(view.ended, 'completed');
  assert.equal(Object.hasOwn(f.projection.definition.wire.view(f.projection.stateOf(child.session)), 'messages'), false);
  const running = await f.operate({ action: 'status' });
  assert.equal(running.running, true);
  assert.deepEqual(running.messages, view.messages);
  assert.equal(running.ended, view.ended);
  await f.created[0].handle.dispose();
  const cold = await f.operate({ action: 'status' });
  assert.equal(cold.running, false);
  assert.deepEqual(cold.messages, view.messages);
  assert.equal(cold.ended, view.ended);
  assert.equal(f.live.has(child.id), false, 'status must use the passive controller rather than resume an Agent');
  assert.equal(f.created.length, 1);
});

test('human --keep converts the same child with native durable commands and preserves conversation activity', async t => {
  const f = await fixture(t);
  const opened = await f.operate({ action: 'ask', question: 'Explain this design' });
  const child = f.live.get(opened.childId);
  const question = child.inbox.nextTurn[0];
  const turn = child.initialLastTurn + 1;
  child.session.append('turn/start', { turn });
  child.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] });
  child.session.append('user/message', question, { surfaceOp: 'append' });
  child.session.append('step/start', { turn, step: 1 });
  child.session.append('assistant/message', {
    turn, step: 1, stream: [], message: {
      id: randomUUID(), role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test-model' }, content: text('A useful design explanation'),
    },
  }, { surfaceOp: 'append' });
  child.session.append('step/end', { turn, step: 1 });
  child.session.append('turn/end', { turn, reason: { kind: 'completed' } });
  await f.operate({ action: 'ask', question: 'A queued follow-up' });
  child.session.append('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [user('Pending steering')] });
  const childEvents = child.session.snapshotEvents();
  const parentEvents = f.parent.session.snapshotEvents();
  const header = child.session.header;
  const messages = child.session.deriveMessages();
  const transcript = f.projection.stateOf(child.session).messages;
  const pending = { parent: readInbox(f.parent.session), child: readInbox(child.session) };
  const followups = [...child.followups];
  const revision = f.projection.stateOf(f.parent.session).revision;
  const flushStart = f.flushed.length;
  assert.deepEqual([...child.policies.prompts].map(p => p.text), [SIDE_POLICY]);

  const outcome = await f.command(`--keep ${child.id}`);
  assert.equal(outcome.kind, 'success', outcome.text);
  const result = decodeResult(outcome.text);
  assert.equal(result.action, 'keep');
  assert.equal(result.childId, null);
  assert.equal(result.promotedId, child.id);
  assert.equal(f.created.length, 1);
  assert.equal(f.live.get(child.id), child);
  assert.equal(child.disposed, false);
  assert.deepEqual(f.archived, []);
  assert.deepEqual(child.cancellations, []);
  assert.deepEqual(f.parent.cancellations, []);
  assert.equal(child.status, 'running');
  assert.equal(f.parent.status, 'running');
  assert.deepEqual(child.followups, followups);
  assert.deepEqual({ parent: readInbox(f.parent.session), child: readInbox(child.session) }, pending);
  assert.deepEqual(child.session.header, header);
  assert.deepEqual(child.session.deriveMessages(), messages);
  assert.deepEqual(child.session.snapshotEvents().slice(0, childEvents.length), childEvents);
  const promotion = child.session.snapshotEvents().slice(childEvents.length);
  assert.deepEqual(promotion.map(e => e.type), ['session/title', 'command/run', 'command/done'],
    'queued-question naming records the user-requested title without inventing committed human messages or invalid V4 citations');
  const promotionCommands = promotion.filter(event => event.type === 'command/run' || event.type === 'command/done');
  assert.equal(promotionCommands[0].data.name, 'side');
  assert.equal(promotionCommands[1].data.commandId, promotionCommands[0].data.commandId);
  assert.equal(promotionCommands[1].data.kind, 'success');
  assert.deepEqual(decodeResult(promotionCommands[1].data.text), { parentId: child.id, childId: null, action: 'promoted' });
  assert.deepEqual(promotion[0].data, { title: '旁支新标题', source: { kind: 'user' }, messageSeqs: [] });
  assert.equal(f.titleRequests.length, 1);
  assert.equal(f.renameCalls.length, 1);
  assert.equal(f.renameCalls[0].session, child.session);
  assert.equal(f.ctx.sessionTitle.get(child.session).title, '旁支新标题');
  const parentLog = f.parent.session.snapshotEvents().slice(parentEvents.length);
  assert.deepEqual(parentLog.map(e => e.type), ['command/run', 'command/done']);
  assert.equal(parentLog[0].data.name, 'side');
  assert.equal(parentLog[1].data.commandId, parentLog[0].data.commandId);
  assert.deepEqual(decodeResult(parentLog[1].data.text), { parentId: f.parent.id, childId: null, action: 'keep', promotedId: child.id });
  assert.deepEqual(f.flushed.slice(flushStart), [child.id, f.parent.id], 'the converted child must be durable before the parent detaches');
  const childState = f.projection.stateOf(child.session);
  assert.equal(childState.permanent, true);
  assert.equal(childState.parentId, f.parent.id);
  assert.equal(isTemporary(childState), false);
  assert.deepEqual(childState.messages, transcript);
  const parentState = f.projection.stateOf(f.parent.session);
  assert.equal(parentState.childId, null);
  assert.equal(parentState.promotedId, child.id);
  assert.equal(parentState.revision, revision);
  assert.deepEqual([...child.policies.prompts].map(p => p.text), [PERMANENT_POLICY]);
  assert.equal(child.policies.guards.size, 0);
  assert.equal(child.policies.restrictions.size, 0);

  const artifact = nativeRoundTrip(child.session);
  assert.deepEqual(artifact.header, header);
  const restored = Session.fromRestore(child.id, artifact.events, artifact.header, artifact.inheritedEventCount, 'shared-frozen');
  assert.deepEqual(restored.deriveMessages(), messages);
  assert.equal(f.projection.stateOf(restored).permanent, true);
  assert.deepEqual(f.projection.stateOf(restored).messages, transcript);
  assert.deepEqual(f.ctx.sessionTitle.get(restored), f.ctx.sessionTitle.get(child.session), 'native V4 restore preserves the accepted title');
  assert.deepEqual(restored.ownEvents().filter(event => event.type === 'session/title-llm-request'), promotion.filter(event => event.type === 'session/title-llm-request'));
});

test('promotion regenerates a native persisted title from the last own human question on the child route', async t => {
  const f = await fixture(t);
  f.parent.session.append('session/title', {
    title: 'Inherited main task title', source: { kind: 'provider', provider: 'test-title' },
    messageSeqs: [f.parent.session.snapshotEvents().find(event => event.type === 'user/message').seq],
  });
  const opened = await f.operate({ action: 'open' });
  const child = f.live.get(opened.childId);
  admitQuestion(child, 'First own side question');
  const latest = admitQuestion(child, 'Last own side question about the promotion design');
  child.model.select({ provider: 'side-provider', model: 'side-model', reasoningEffort: 'high' });
  f.control.titleText = '  独立讨论的新标题  ';
  const messages = child.session.deriveMessages();
  const outcome = await f.command('--keep');
  assert.equal(outcome.kind, 'success', outcome.text);
  assert.equal(f.titleCalls.length, 1);
  const call = f.titleCalls[0];
  assert.equal(call.config.provider, 'side-provider');
  assert.equal(call.config.model, 'side-model');
  assert.equal(typeof call.selector, 'function');
  assert.equal(call.resolved.reasoningEffort, 'low', 'title generation selects the lowest advertised reasoning effort');
  assert.equal(call.resolved.maxTokens, 1024);
  const request = f.titleRequests[0];
  assert.equal(request.sessionId, child.id);
  assert.equal(request.provider, 'side-provider');
  assert.equal(request.model, 'side-model');
  assert.equal(request.purpose, 'session-title');
  const prompt = JSON.stringify(request.messages);
  assert.ok(prompt.includes(latest.data.content[0].text));
  const source = child.session.ownEvents().find(event => event.type === 'session/title-llm-request');
  assert.deepEqual(source.data.messageSeqs, [latest.seq]);
  assert.deepEqual(source.data.route, { provider: 'side-provider', model: 'side-model' });
  assert.deepEqual(source.data.messages, request.messages, 'the native auxiliary record preserves the actual model input');
  assert.equal(source.data.system, request.system);
  assert.equal(source.data.maxTokens, 1024);
  assert.equal(source.data.reasoningEffort, 'low');
  assert.ok(Buffer.byteLength(request.messages[0].content[0].text) <= 8192);
  for (const excluded of ['First own side question', 'Continue the main task', 'Queued inherited task', 'Inherited steering']) {
    assert.equal(prompt.includes(excluded), false, `title input must exclude ${excluded}`);
  }
  assert.equal(f.renameCalls.length, 1);
  assert.equal(f.renameCalls[0].session, child.session);
  const title = f.ctx.sessionTitle.get(child.session);
  assert.equal(title.title, '独立讨论的新标题');
  assert.deepEqual(title.source, { kind: 'user' }, 'explicit promotion accepts the AI result through native rename and pins it');
  assert.deepEqual(title.messageSeqs, []);
  assert.deepEqual(child.session.deriveMessages(), messages, 'title generation must not inject a chat message');
  const artifact = nativeRoundTrip(child.session);
  const restored = Session.fromRestore(child.id, artifact.events, artifact.header, artifact.inheritedEventCount, 'shared-frozen');
  assert.deepEqual(f.ctx.sessionTitle.get(restored), title);
  assert.equal(f.projection.stateOf(restored).permanent, true);
  assert.equal(restored.ownEvents().filter(event => event.type === 'session/title-llm-request').length, 1);
});

test('promotion chooses pending or admitted own questions by event chronology and ignores removed inbox input', async t => {
  for (const scenario of ['newer pending', 'newer admitted', 'removed pending', 'newer next-step']) {
    await t.test(scenario, async t => {
      const f = await fixture(t);
      const opened = await f.operate({ action: 'ask', question: 'Older still pending own question' });
      const child = f.live.get(opened.childId);
      const current = admitQuestion(child, 'More recent admitted own question');
      let expected = current.data.content[0].text;
      if (scenario === 'newer pending' || scenario === 'removed pending') {
        await f.operate({ action: 'ask', question: 'Newest pending own question' });
        if (scenario === 'newer pending') expected = 'Newest pending own question';
        else child.session.append('agent/inbox/spliced', { target: 'next-turn', start: 1, removedCount: 1, inserted: [], outcome: 'canceled' });
      }
      if (scenario === 'newer next-step') {
        expected = 'Newest pending human steering';
        child.session.append('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [user(expected)] });
      }
      const pending = readInbox(child.session);
      const outcome = await f.command('--keep');
      assert.equal(outcome.kind, 'success', outcome.text);
      assert.equal(f.titleRequests.length, 1);
      const prompt = JSON.stringify(f.titleRequests[0].messages);
      assert.ok(prompt.includes(expected), `title request selects ${expected}`);
      for (const other of ['Older still pending own question', 'More recent admitted own question', 'Newest pending own question', 'Newest pending human steering']) {
        if (other !== expected) assert.equal(prompt.includes(other), false, `title request excludes ${other}`);
      }
      assert.deepEqual(readInbox(child.session), pending, 'selecting pending title input must not admit, cancel or re-enqueue it');
      assert.doesNotThrow(() => nativeRoundTrip(child.session));
    });
  }
});

test('promotion without an own human question leaves the inherited title alone', async t => {
  const f = await fixture(t);
  f.ctx.sessionTitle.rename(f.parent.session, 'Main task user title');
  const opened = await f.operate({ action: 'open' });
  const child = f.live.get(opened.childId);
  const inherited = f.ctx.sessionTitle.get(child.session);
  const renameCount = f.renameCalls.length;
  const outcome = await f.command('--keep');
  assert.equal(outcome.kind, 'success', outcome.text);
  assert.deepEqual(f.ctx.sessionTitle.get(child.session), inherited);
  assert.deepEqual(f.titleCalls, []);
  assert.deepEqual(f.titleRequests, []);
  assert.equal(f.renameCalls.length, renameCount);
  assert.equal(f.projection.stateOf(child.session).permanent, true);
});

test('repeated keep and resume never regenerate or overwrite a later user title', async t => {
  const f = await fixture(t);
  const opened = await f.operate({ action: 'ask', question: 'Keep this named conversation' });
  const original = f.created[0].handle;
  const child = original.agent;
  assert.equal((await f.command('--keep')).kind, 'success');
  const title = f.ctx.sessionTitle.rename(child.session, 'My later user title');
  const events = child.session.snapshotEvents();
  for (const input of ['--keep', `--keep ${child.id}`]) {
    const outcome = await f.command(input);
    assert.equal(outcome.kind, 'success', outcome.text);
  }
  assert.deepEqual(child.session.snapshotEvents(), events);
  await original.dispose();
  const resumed = await f.ctx.agents.resume({ resumeSessionId: opened.childId });
  t.after(() => resumed.dispose());
  const resumedEvents = resumed.agent.session.snapshotEvents();
  assert.deepEqual(resumedEvents.slice(0, events.length), events);
  assert.deepEqual(resumedEvents.slice(events.length).map(event => event.type), ['session/end-seed'], 'native resume appends only its seed boundary');
  const outcome = await f.command(`--keep ${child.id}`);
  assert.equal(outcome.kind, 'success', outcome.text);
  assert.equal(f.titleCalls.length, 1);
  assert.equal(f.titleRequests.length, 1);
  assert.equal(f.renameCalls.length, 2, 'one promotion rename and one explicit later user rename');
  assert.deepEqual(f.ctx.sessionTitle.get(resumed.agent.session), title);
  assert.deepEqual(resumed.agent.session.snapshotEvents(), resumedEvents);
});

test('a failed title model call accepts the last question fallback and still converts the same child', async t => {
  const f = await fixture(t);
  const opened = await f.operate({ action: 'ask', question: 'Earlier side question' });
  await f.operate({ action: 'ask', question: 'Fallback question for this conversation' });
  const child = f.live.get(opened.childId);
  const pending = readInbox(child.session);
  const messages = child.session.deriveMessages();
  f.control.titleError = new Error('title provider unavailable');
  const outcome = await f.command('--keep');
  assert.equal(outcome.kind, 'success', outcome.text);
  assert.equal(decodeResult(outcome.text).promotedId, child.id);
  assert.equal(f.live.get(child.id), child);
  assert.equal(f.created.length, 1);
  assert.equal(f.projection.stateOf(child.session).permanent, true);
  assert.equal(f.ctx.sessionTitle.get(child.session).title, 'Fallback question for this conversation');
  assert.deepEqual(f.ctx.sessionTitle.get(child.session).source, { kind: 'user' });
  assert.equal(f.titleRequests.length, 1);
  assert.equal(f.renameCalls.length, 1);
  assert.deepEqual(readInbox(child.session), pending);
  assert.deepEqual(child.session.deriveMessages(), messages);
  assert.doesNotThrow(() => nativeRoundTrip(child.session));
});

test('caller abort during title generation leaves the same temporary child without a rename or promotion', async t => {
  const f = await fixture(t);
  const opened = await f.operate({ action: 'ask', question: 'Keep this question available after cancellation' });
  const child = f.live.get(opened.childId);
  const pending = readInbox(child.session);
  const messages = child.session.deriveMessages();
  let enter;
  let release;
  const entered = new Promise(resolve => { enter = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  f.control.beforeTitle = async options => { enter(options); await barrier; };
  const controller = new AbortController();
  const conversion = f.command('--keep', controller.signal);
  try {
    const stage = await Promise.race([entered.then(options => ({ options })), conversion.then(outcome => ({ outcome }))]);
    assert.ok(stage.options, 'conversion must reach and await native title generation');
    assert.equal(f.projection.stateOf(child.session).permanent, false);
    controller.abort(new Error('caller canceled title generation'));
    assert.equal(stage.options.signal.aborted, true, 'title generation receives caller cancellation');
  } finally { release(); }
  const outcome = await conversion;
  assert.equal(outcome.kind, 'error');
  assert.match(outcome.text, /caller canceled title generation/);
  assert.deepEqual(f.renameCalls, []);
  assert.equal(f.ctx.sessionTitle.get(child.session), undefined);
  assert.equal(f.projection.stateOf(child.session).permanent, false);
  assert.equal(f.projection.stateOf(f.parent.session).childId, child.id);
  assert.equal(f.projection.stateOf(f.parent.session).promotedId, null);
  assert.equal(child.session.ownEvents().some(event => event.type === 'command/done' && decodeResult(event.data.text)?.action === 'promoted'), false);
  assert.equal(f.live.get(child.id), child);
  assert.equal(child.disposed, false);
  assert.equal(f.created.length, 1);
  assert.deepEqual(readInbox(child.session), pending);
  assert.deepEqual(child.session.deriveMessages(), messages);
  assert.deepEqual([...child.policies.prompts].map(policy => policy.text), [SIDE_POLICY]);
  assert.deepEqual(f.archived, []);
  f.control.beforeTitle = null;
  const retried = await f.command(`--keep ${child.id}`);
  assert.equal(retried.kind, 'success', retried.text);
  assert.equal(f.created.length, 1);
  assert.equal(f.ctx.sessionTitle.get(child.session).title, '旁支新标题');
});

test('a user rename while the promotion title is in flight supersedes the AI result', async t => {
  const f = await fixture(t);
  const opened = await f.operate({ action: 'ask', question: 'Name this side after its last question' });
  const child = f.live.get(opened.childId);
  let enter;
  let release;
  const entered = new Promise(resolve => { enter = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  f.control.beforeTitle = async () => { enter(); await barrier; };
  const conversion = f.command('--keep');
  let title;
  try {
    const stage = await Promise.race([entered.then(() => 'generating'), conversion.then(() => 'completed')]);
    assert.equal(stage, 'generating', 'conversion awaits the title response before promotion');
    title = f.ctx.sessionTitle.rename(child.session, '  User choice wins  ');
  } finally { release(); }
  const outcome = await conversion;
  assert.equal(outcome.kind, 'success', outcome.text);
  assert.deepEqual(f.ctx.sessionTitle.get(child.session), title);
  assert.equal(title.title, 'User choice wins');
  assert.equal(f.renameCalls.length, 1, 'the late AI result must not issue a second native rename');
  assert.equal(f.titleRequests.length, 1);
  assert.equal(f.projection.stateOf(child.session).permanent, true);
  assert.equal(f.projection.stateOf(f.parent.session).promotedId, child.id);
  assert.doesNotThrow(() => nativeRoundTrip(child.session));
});

test('duplicate --keep is idempotent and --close leaves the converted child live', async t => {
  const f = await fixture(t);
  const opened = await f.operate({ action: 'ask', question: 'Keep this conversation' });
  const child = f.live.get(opened.childId);
  assert.equal((await f.command('--keep')).kind, 'success');
  const childEvents = child.session.snapshotEvents();
  for (const input of ['--keep', `--keep ${child.id}`]) {
    const outcome = await f.command(input);
    assert.equal(outcome.kind, 'success', outcome.text);
    assert.equal(decodeResult(outcome.text).promotedId, child.id);
    assert.deepEqual(child.session.snapshotEvents(), childEvents, 'an already converted child needs no second promotion record');
  }
  assert.equal((await f.command('--close')).kind, 'success');
  assert.equal(f.projection.stateOf(f.parent.session).promotedId, child.id);
  assert.equal(f.created.length, 1);
  assert.deepEqual(f.archived, []);
  assert.equal(f.live.get(child.id), child);
  assert.equal(child.disposed, false);
  assert.deepEqual(child.cancellations, []);
  assert.deepEqual(child.session.snapshotEvents(), childEvents);
});

test('first conversion awaits attachment to the parent current workspace before becoming permanent', async t => {
  const f = await fixture(t);
  const cwdMatch = f.addWorkspace('cwd-match', [], f.parent.session.header.cwd);
  const workspace = f.addWorkspace('parent-current', [f.parent.id]);
  const opened = await f.operate({ action: 'ask', question: 'Keep the current workspace group' });
  const child = f.live.get(opened.childId);
  const header = { ...child.session.header };
  assert.deepEqual(f.attachments, [], 'temporary sides must not be attached by creation');
  let entered;
  let release;
  const attaching = new Promise(resolve => { entered = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  f.control.beforeAttach = async (target, sessionId) => {
    assert.equal(target, workspace);
    assert.equal(sessionId, child.id);
    entered();
    await barrier;
  };
  let completed = false;
  const conversion = f.command('--keep').then(outcome => { completed = true; return outcome; });
  try {
    const stage = await Promise.race([attaching.then(() => 'attaching'), conversion.then(() => 'completed')]);
    assert.equal(stage, 'attaching', 'conversion must attach to the parent current workspace');
    assert.equal(completed, false, 'conversion must wait for workspace durability');
    assert.equal(f.projection.stateOf(child.session).permanent, false);
    assert.equal(f.projection.stateOf(f.parent.session).childId, child.id);
    assert.deepEqual(workspace.sessionIds, [f.parent.id]);
    assert.deepEqual(f.titleRequests, [], 'workspace attachment must finish before title generation starts');
    assert.deepEqual(f.renameCalls, []);
  } finally { release(); }
  const outcome = await conversion;
  assert.equal(outcome.kind, 'success', outcome.text);
  assert.deepEqual(f.attachments, [{ workspaceId: workspace.id, sessionId: child.id }]);
  assert.deepEqual(workspace.sessionIds, [f.parent.id, child.id]);
  assert.deepEqual(cwdMatch.sessionIds, [], 'membership must not be resolved from the inherited cwd');
  assert.equal(f.projection.stateOf(child.session).permanent, true);
  assert.equal(f.projection.stateOf(f.parent.session).childId, null);
  assert.deepEqual(child.session.header, header, 'workspace placement must preserve the permission root');
});

test('conversion leaves a child ungrouped when its parent has no current workspace membership', async t => {
  const f = await fixture(t);
  const cwdMatch = f.addWorkspace('cwd-match', [], f.parent.session.header.cwd);
  const opened = await f.operate({ action: 'open' });
  const child = f.live.get(opened.childId);
  const header = { ...child.session.header };
  const outcome = await f.command('--keep');
  assert.equal(outcome.kind, 'success', outcome.text);
  assert.deepEqual(f.attachments, []);
  assert.deepEqual(cwdMatch.sessionIds, []);
  assert.equal(f.projection.stateOf(child.session).permanent, true);
  assert.deepEqual(child.session.header, header);
});

test('conversion chooses parent membership at promotion after a move or a previously ungrouped creation', async t => {
  for (const initiallyGrouped of [true, false]) {
    await t.test(initiallyGrouped ? 'moved parent' : 'initially ungrouped parent', async t => {
      const f = await fixture(t);
      const previous = f.addWorkspace('previous', initiallyGrouped ? [f.parent.id] : []);
      const current = f.addWorkspace('current');
      const opened = await f.operate({ action: 'open' });
      const child = f.live.get(opened.childId);
      f.moveSession(f.parent.id, current.id);
      const outcome = await f.command('--keep');
      assert.equal(outcome.kind, 'success', outcome.text);
      assert.deepEqual(f.attachments, [{ workspaceId: current.id, sessionId: child.id }]);
      assert.deepEqual(previous.sessionIds, []);
      assert.deepEqual(current.sessionIds, [f.parent.id, child.id]);
      assert.equal(child.session.header.cwd, '/original-workspace');
    });
  }
});

test('repeated keep, child resume, and opening a replacement preserve a user move after conversion', async t => {
  const f = await fixture(t);
  const parentWorkspace = f.addWorkspace('parent-workspace', [f.parent.id]);
  const userWorkspace = f.addWorkspace('user-workspace');
  const opened = await f.operate({ action: 'open' });
  const original = f.created[0].handle;
  assert.equal((await f.command('--keep')).kind, 'success');
  f.moveSession(opened.childId, userWorkspace.id);
  const attachments = [...f.attachments];
  assert.deepEqual(attachments, [{ workspaceId: parentWorkspace.id, sessionId: opened.childId }]);
  for (const input of ['--keep', `--keep ${opened.childId}`]) {
    const outcome = await f.command(input);
    assert.equal(outcome.kind, 'success', outcome.text);
  }
  await original.dispose();
  const resumed = await f.ctx.agents.resume({ resumeSessionId: opened.childId });
  t.after(() => resumed.dispose());
  assert.equal((await f.command(`--keep ${opened.childId}`)).kind, 'success');
  const next = await f.operate({ action: 'open' });
  assert.notEqual(next.childId, opened.childId);
  assert.deepEqual(f.attachments, attachments, 'ordinary sessions must not be re-placed after conversion');
  assert.deepEqual(parentWorkspace.sessionIds, [f.parent.id]);
  assert.deepEqual(userWorkspace.sessionIds, [opened.childId]);
});

test('workspace attachment failure keeps the same temporary side and all conversation records for retry', async t => {
  const f = await fixture(t);
  const workspace = f.addWorkspace('parent-workspace', [f.parent.id]);
  const opened = await f.operate({ action: 'ask', question: 'Do not lose this pending question' });
  const child = f.live.get(opened.childId);
  const childEvents = child.session.snapshotEvents();
  const parentEvents = f.parent.session.snapshotEvents();
  const pending = readInbox(child.session);
  const messages = child.session.deriveMessages();
  const header = { ...child.session.header };
  workspace.attachError = new Error('workspace attachment failed');
  const failed = await f.command('--keep');
  assert.equal(failed.kind, 'error');
  assert.match(failed.text, /workspace attachment failed/);
  assert.equal(isTemporary(f.projection.stateOf(child.session)), true);
  assert.equal(f.projection.stateOf(f.parent.session).childId, child.id);
  assert.equal(f.projection.stateOf(f.parent.session).promotedId, null);
  assert.deepEqual(child.session.snapshotEvents().slice(0, childEvents.length), childEvents);
  assert.deepEqual(f.parent.session.snapshotEvents(), parentEvents);
  assert.deepEqual(readInbox(child.session), pending);
  assert.deepEqual(child.session.deriveMessages(), messages);
  assert.deepEqual(child.session.header, header);
  assert.equal(child.session.ownEvents().some(event => event.type === 'command/done' && decodeResult(event.data.text)?.action === 'promoted'), false);
  assert.deepEqual([...child.policies.prompts].map(policy => policy.text), [SIDE_POLICY]);
  assert.equal(child.policies.guards.size, 1);
  assert.equal(child.disposed, false);
  assert.deepEqual(child.cancellations, []);
  assert.deepEqual(f.archived, []);
  assert.deepEqual(workspace.sessionIds, [f.parent.id]);
  assert.deepEqual(f.titleCalls, [], 'failed attachment must not prepare a title model call');
  assert.deepEqual(f.titleRequests, []);
  assert.deepEqual(f.renameCalls, []);
  workspace.attachError = null;
  const retried = await f.command(`--keep ${child.id}`);
  assert.equal(retried.kind, 'success', retried.text);
  assert.equal(f.created.length, 1);
  assert.deepEqual(workspace.sessionIds, [f.parent.id, child.id]);
  assert.equal(f.projection.stateOf(child.session).permanent, true);
  assert.deepEqual(readInbox(child.session), pending);
  assert.deepEqual(f.archived, []);
});

test('stale expected child ids cannot promote either a current side or its replacement', async t => {
  const f = await fixture(t);
  const opened = await f.operate({ action: 'open' });
  const first = f.live.get(opened.childId);
  const originalEvents = first.session.snapshotEvents();
  const mismatch = await f.command('--keep side-stale-id');
  assert.equal(mismatch.kind, 'error');
  assert.equal(f.projection.stateOf(f.parent.session).childId, first.id);
  assert.equal(f.projection.stateOf(first.session).permanent, false);
  assert.deepEqual(first.session.snapshotEvents(), originalEvents);
  assert.equal((await f.command(`--keep ${first.id}`)).kind, 'success');
  const replacement = await f.command('--new A distinct side question');
  assert.equal(replacement.kind, 'success', replacement.text);
  const next = f.live.get(decodeResult(replacement.text).childId);
  assert.notEqual(next.id, first.id);
  assert.equal(f.created.length, 2);
  assert.equal(isTemporary(f.projection.stateOf(next.session)), true);
  assert.equal(f.projection.stateOf(f.parent.session).promotedId, null);
  assert.deepEqual(next.inbox.nextTurn.map(m => m.content[0].text), ['A distinct side question']);
  assert.equal(f.live.get(first.id), first);
  assert.equal(first.disposed, false);
  assert.deepEqual(first.cancellations, []);
  const nextEvents = next.session.snapshotEvents();
  const stale = await f.command(`--keep ${first.id}`);
  assert.equal(stale.kind, 'error');
  assert.equal(f.projection.stateOf(f.parent.session).childId, next.id);
  assert.equal(f.projection.stateOf(next.session).permanent, false);
  assert.deepEqual(next.session.snapshotEvents(), nextEvents);
  assert.deepEqual(f.archived, []);
});

test('the shared Agent tool does not advertise or execute user-only promotion', async t => {
  const f = await fixture(t);
  const opened = await f.operate({ action: 'open' });
  const child = f.live.get(opened.childId);
  const tool = f.ctx.tools.schemas().find(definition => definition.name === 'side_conversation');
  assert.ok(tool);
  assert.equal(tool.parameters.properties.action.enum.includes('keep'), false);
  assert.equal(tool.parameters.properties.action.enum.includes('promote'), false);
  const parentEvents = f.parent.session.snapshotEvents();
  const childEvents = child.session.snapshotEvents();
  for (const action of ['keep', 'promote']) {
    await assert.rejects(tool.execute({ action }, { agent: f.parent, signal: new AbortController().signal }), /invalid side action/i);
  }
  assert.deepEqual(f.parent.session.snapshotEvents(), parentEvents);
  assert.deepEqual(child.session.snapshotEvents(), childEvents);
  assert.equal(f.projection.stateOf(child.session).permanent, false);
  assert.deepEqual(f.archived, []);
});

test('a resumed converted child reconstructs exactly one permanent policy and can open its own side', async t => {
  const f = await fixture(t);
  const opened = await f.operate({ action: 'open' });
  const original = f.created[0].handle;
  assert.equal((await f.command('--keep')).kind, 'success');
  await original.dispose();
  const handle = await f.ctx.agents.resume({ resumeSessionId: opened.childId });
  t.after(() => handle.dispose());
  const resumed = handle.agent;
  assert.notEqual(resumed, original.agent);
  assert.equal(resumed.policies.guards.size, 0);
  assert.equal(resumed.policies.restrictions.size, 0);
  assert.deepEqual([...resumed.policies.prompts].map(p => p.text), [PERMANENT_POLICY]);
  assert.equal(f.projection.stateOf(resumed.session).parentId, f.parent.id);
  const side = await f.operate({ action: 'open' }, undefined, resumed);
  assert.notEqual(side.childId, resumed.id);
  assert.equal(isTemporary(f.projection.stateOf(f.live.get(side.childId).session)), true);
  assert.deepEqual([...resumed.policies.prompts].map(p => p.text), [PERMANENT_POLICY]);
});

test('a failed child promotion checkpoint protects the marked child and retries durability before detaching', async t => {
  const f = await fixture(t);
  const parentWorkspace = f.addWorkspace('parent-workspace', [f.parent.id]);
  const userWorkspace = f.addWorkspace('user-workspace');
  const opened = await f.operate({ action: 'ask', question: 'Preserve pending work' });
  const child = f.live.get(opened.childId);
  const pending = readInbox(child.session);
  f.control.flushFailure = session => {
    if (session.id === child.id && f.projection.stateOf(session).permanent) throw new Error('child promotion checkpoint failed');
  };
  const outcome = await f.command(`--keep ${child.id}`);
  assert.equal(outcome.kind, 'error');
  assert.match(outcome.text, /child promotion checkpoint failed/);
  assert.equal(f.projection.stateOf(child.session).permanent, true);
  assert.equal(f.projection.stateOf(f.parent.session).childId, child.id);
  assert.deepEqual(f.attachments, [{ workspaceId: parentWorkspace.id, sessionId: child.id }]);
  assert.deepEqual(parentWorkspace.sessionIds, [f.parent.id, child.id]);
  f.moveSession(child.id, userWorkspace.id);
  const protectedClose = await f.command('--close');
  assert.equal(protectedClose.kind, 'error', 'close must retry the failed child checkpoint before detaching');
  const protectedNew = await f.command('--new A replacement must wait');
  assert.equal(protectedNew.kind, 'error', 'new must also reconcile child durability before creating a replacement');
  assert.equal(f.created.length, 1);
  assert.deepEqual(f.archived, []);
  assert.equal(child.disposed, false);
  assert.deepEqual(child.cancellations, []);
  assert.deepEqual(readInbox(child.session), pending);
  const promotionCount = child.session.ownEvents().filter(e => e.type === 'command/done' && decodeResult(e.data.text)?.action === 'promoted').length;
  assert.equal(promotionCount, 1);
  f.control.flushFailure = null;
  const flushStart = f.flushed.length;
  const recovered = await f.command('--close');
  assert.equal(recovered.kind, 'success', recovered.text);
  assert.deepEqual(f.flushed.slice(flushStart, flushStart + 2), [child.id, f.parent.id]);
  assert.equal(f.projection.stateOf(f.parent.session).childId, null);
  assert.equal(f.projection.stateOf(f.parent.session).promotedId, child.id);
  assert.deepEqual(f.archived, []);
  assert.equal(f.live.get(child.id), child);
  assert.deepEqual(readInbox(child.session), pending);
  assert.deepEqual(f.attachments, [{ workspaceId: parentWorkspace.id, sessionId: child.id }], 'detaching an already permanent child must not repeat workspace placement');
  assert.deepEqual(parentWorkspace.sessionIds, [f.parent.id]);
  assert.deepEqual(userWorkspace.sessionIds, [child.id]);
  assert.doesNotThrow(() => nativeRoundTrip(child.session));
});

test('parent checkpoint failure after durable promotion cannot make a later close archive the child', async t => {
  const f = await fixture(t);
  const opened = await f.operate({ action: 'ask', question: 'Continue independently' });
  const child = f.live.get(opened.childId);
  const pending = readInbox(child.session);
  const flushStart = f.flushed.length;
  f.control.flushFailure = session => { if (session.id === f.parent.id) throw new Error('parent promotion checkpoint failed'); };
  const outcome = await f.command('--keep');
  assert.equal(outcome.kind, 'error');
  assert.match(outcome.text, /parent promotion checkpoint failed/);
  assert.deepEqual(f.flushed.slice(flushStart, flushStart + 2), [child.id, f.parent.id]);
  assert.equal(f.projection.stateOf(child.session).permanent, true);
  assert.equal(f.projection.stateOf(f.parent.session).promotedId, child.id);
  await f.command('--close');
  assert.deepEqual(f.archived, []);
  assert.equal(child.disposed, false);
  assert.deepEqual(child.cancellations, []);
  assert.deepEqual(readInbox(child.session), pending);
  f.control.flushFailure = null;
  assert.equal((await f.command('--close')).kind, 'success');
  assert.equal(f.projection.stateOf(f.parent.session).childId, null);
  assert.equal(f.projection.stateOf(f.parent.session).promotedId, child.id);
  assert.deepEqual(f.archived, []);
  assert.equal(f.live.get(child.id), child);
  assert.doesNotThrow(() => nativeRoundTrip(child.session));
});

test('close checkpoint failure still disposes the already archived side', async t => {
  const f = await fixture(t);
  const opened = await f.operate({ action: 'open' });
  const child = f.live.get(opened.childId);
  f.control.flushFailure = session => { if (session.id === 'main') throw new Error('close checkpoint failed'); };
  await assert.rejects(f.operate({ action: 'close' }), /close checkpoint failed/);
  assert.equal(f.projection.stateOf(f.parent.session).childId, null);
  assert.equal(child.disposed, true, 'an archival already committed before the checkpoint failed; release its Agent handle');
  assert.equal(f.live.has(child.id), false);
  assert.deepEqual(f.parent.cancellations, []);
});
