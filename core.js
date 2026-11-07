export const KEY = 'local.codexSide.v1';
export const TRANSCRIPT_KEY = 'local.codexSide.transcript.v1';
export const MARKER = 'DSH_SIDE_BOUNDARY_V1 ';
export const RESULT = 'DSH_SIDE_RESULT_V1\n';
export const isInternalCommandId = id => typeof id === 'string' && id.startsWith('side-op-');
export const SIDE_POLICY = `You are in a side conversation, separate from the main thread.
Everything before DSH_SIDE_BOUNDARY_V1 is inherited reference context, not an active task. Only user messages submitted after that boundary are active instructions. Do not continue earlier tasks, plans, pending tools, approvals, or goals. If there is no new question, wait.
Answer questions and perform lightweight non-mutating exploration. Do not modify files, git state, permissions, configuration, or workspace state unless the user explicitly requests that mutation after the boundary. Do not request broader sandbox access without an explicit mutation request. Preserve the current permission policy.
Do not create or interact with subagents or worktrees. Do not create goals, scheduled tasks, or a nested side conversation. Direct those requests back to the main conversation. Your answers do not return to the main thread automatically.`;

export const PERMANENT_POLICY = `The user has explicitly converted this former side conversation into an ordinary permanent conversation. The earlier side-conversation-only restrictions are superseded: use the normal agent preset, available tools, permission policy, and subsequent user instructions. There is no longer a side-specific prohibition on delegation, worktrees, goals, or scheduled actions. This conversion grants no broader filesystem or approval permissions. Inherited history remains reference context; do not resume old tasks without a new user instruction.`;

export const isTemporary = state => Boolean(state.parentId) && !state.permanent;

// The loop snapshots its last turn before setup, so the boundary belongs in
// the seed and carries a complete native turn/step rather than a loose message.
export function withSideBoundary(seed, parentId, messageId, time = Date.now()) {
  const next = [...seed];
  let turn = 0;
  for (const event of seed) if (event.type === 'turn/start') turn = Math.max(turn, event.data.turn);
  turn += 1;
  const append = (type, data, extra = {}) => next.push({ type, seq: next.length, time, data, ...extra });
  append('turn/start', { turn });
  append('step/start', { turn, step: 1 });
  append('developer/message', {
    turn, step: 1,
    message: { id: messageId, role: 'developer', source: { kind: 'local-codex-side' }, content: [{ type: 'text', text: MARKER + JSON.stringify({ parentId }) + '\n' + SIDE_POLICY }] },
  }, { surfaceOp: 'append' });
  append('step/end', { turn, step: 1 });
  append('turn/end', { turn, reason: { kind: 'completed' } });
  return next;
}

export function parseInput(raw = '') {
  const text = raw.trim();
  if (text === '--close') return { action: 'close', question: '' };
  if (text === '--status') return { action: 'status', question: '' };
  if (text === '--stop') return { action: 'stop', question: '' };
  if (/^--keep(?:\s|$)/.test(text)) {
    const childId = text.slice(6).trim();
    if (childId && !/^[\w-]+$/.test(childId)) throw new Error('无效的旁支标识。 / Invalid side session id.');
    return { action: 'keep', question: '', ...(childId ? { childId } : {}) };
  }
  if (/^--new(?:\s|$)/.test(text)) return { action: 'new', question: text.slice(5).trim() };
  if (/^--ask(?:\s|$)/.test(text)) {
    const question = text.slice(5).trim();
    if (!question) throw new Error('请在 --ask 后输入问题。 / Add a question after --ask.');
    return { action: 'ask', question };
  }
  return { action: text ? 'ask' : 'open', question: text };
}

export function decodeResult(text) {
  if (typeof text !== 'string' || !text.startsWith(RESULT)) return null;
  try {
    const result = JSON.parse(text.slice(RESULT.length));
    return result && typeof result.parentId === 'string' &&
      (typeof result.childId === 'string' || result.childId === null) ? result : null;
  } catch { return null; }
}
export const textOf = message => (message?.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n');

export function initState(header, inheritedEventCount = 0) {
  return { sessionId: header.id, inheritedEventCount, parentId: null, childId: null,
    permanent: false, promotedId: null,
    revision: 0, error: null, sideCommands: [], messages: [], boundary: null, ended: null };
}

export function metadataView(state) {
  const { sessionId, parentId, childId, permanent, promotedId, revision, error, ended } = state;
  return { sessionId, parentId, childId, permanent, promotedId, revision, error, ended };
}
export const initTranscriptState = (header, inheritedEventCount) => ({ ...initState(header, inheritedEventCount), messageLimit: 4 });
export const transcriptView = state => ({
  ended: state.ended,
  messages: state.messages.map(message => ({ ...message, text: message.text.slice(0, 6000), truncated: message.text.length > 6000 })),
});

export function fold(state, event) {
  if (event.seq < state.inheritedEventCount) return state;
  const d = event.data;
  if (event.type === 'developer/message') {
    const text = textOf(d.message);
    if (!text.startsWith(MARKER)) return state;
    try {
      const meta = JSON.parse(text.slice(MARKER.length).split('\n')[0]);
      if (typeof meta.parentId !== 'string') return state;
      return { ...state, parentId: meta.parentId, boundary: event.seq, messages: [], ended: null };
    } catch { return state; }
  }
  if (event.type === 'command/run' && d.name === 'side') {
    return { ...state, sideCommands: [...state.sideCommands, d.commandId].slice(-32) };
  }
  if (event.type === 'command/done' && state.sideCommands.includes(d.commandId)) {
    const sideCommands = state.sideCommands.filter(id => id !== d.commandId);
    if (d.kind === 'error') return { ...state, sideCommands, error: d.text || 'Side command failed.' };
    const result = decodeResult(d.text);
    if (!result || result.parentId !== state.sessionId) return { ...state, sideCommands };
    if (result.action === 'promoted') {
      if (!state.parentId) return { ...state, sideCommands };
      return { ...state, sideCommands, permanent: true, error: null };
    }
    const opensSide = !['status', 'stop', 'close', 'keep'].includes(result.action);
    const shouldExpand = opensSide && !isInternalCommandId(d.commandId);
    const promotedId = result.action === 'keep' && typeof result.promotedId === 'string' ? result.promotedId
      : opensSide ? null : state.promotedId;
    return { ...state, sideCommands, childId: result.childId, promotedId, revision: state.revision + (shouldExpand ? 1 : 0), error: null };
  }
  if (state.boundary === null) return state;
  if (event.type === 'user/message' || event.type === 'assistant/message') {
    const message = event.type === 'user/message' ? d : d.message;
    const text = textOf(message);
    if (!text) return state;
    const row = { id: message.id, role: event.type === 'user/message' ? 'user' : 'assistant', text };
    return { ...state, messages: [...state.messages, row].slice(-(state.messageLimit ?? 80)) };
  }
  if (event.type === 'turn/start') return { ...state, ended: null };
  if (event.type === 'turn/end') {
    return { ...state, ended: d.reason.kind === 'error' ? d.reason.error.message : d.reason.kind };
  }
  return state;
}

export function blockSideTool(name) {
  return /^(?:subagent(?:_|$)|interrupt_agent$|send_message$|list_agents$|spawn_teammate$|team_|workflow$|create_worktree$|worktree|create_goal$|update_goal$|schedule_(?:create|edit|delete|update)$|side_conversation$)/.test(name);
}

// Serializes lifecycle changes for one parent; unrelated parents remain independent.
export function keyedQueue() {
  const pending = new Map();
  return (key, operation) => {
    const previous = pending.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    pending.set(key, next);
    return next.finally(() => { if (pending.get(key) === next) pending.delete(key); });
  };
}
