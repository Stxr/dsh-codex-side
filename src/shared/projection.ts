import { MARKER, isInternalCommandId, isRecord } from './protocol.js';
import type { SideEvent, SideMetadata, SideState, TranscriptMessage } from './protocol.js';
import { textOf } from './content.js';
import { decodeResult } from './input.js';

export function initState(header: { id: string }, inheritedEventCount = 0): SideState {
  return { sessionId: header.id, inheritedEventCount, parentId: null, childId: null,
    permanent: false, promotedId: null, revision: 0, error: null, sideCommands: [], messages: [], boundary: null, ended: null };
}
export function metadataView(state: SideState): SideMetadata {
  const { sessionId, parentId, childId, permanent, promotedId, revision, error, ended } = state;
  return { sessionId, parentId, childId, permanent, promotedId, revision, error, ended };
}
export const initTranscriptState = (header: { id: string }, inheritedEventCount = 0): SideState =>
  ({ ...initState(header, inheritedEventCount), messageLimit: 4 });
export const transcriptView = (state: SideState): { ended: string | null; messages: TranscriptMessage[] } => ({
  ended: state.ended,
  messages: state.messages.map(message => ({ ...message, text: message.text.slice(0, 6000), truncated: message.text.length > 6000 })),
});

/** 保持 v4 checkpoint 形状及内部命令不展开侧栏的旧语义。 */
export function fold(state: SideState, event: SideEvent): SideState {
  if (event.seq < state.inheritedEventCount || !isRecord(event.data)) return state;
  const d = event.data;
  if (event.type === 'developer/message') {
    const text = textOf(d.message);
    if (!text.startsWith(MARKER)) return state;
    try {
      const meta: unknown = JSON.parse(text.slice(MARKER.length).split('\n')[0]);
      if (!isRecord(meta) || typeof meta.parentId !== 'string') return state;
      return { ...state, parentId: meta.parentId, boundary: event.seq, messages: [], ended: null };
    } catch { return state; }
  }
  if (event.type === 'command/run' && d.name === 'side' && typeof d.commandId === 'string') {
    return { ...state, sideCommands: [...state.sideCommands, d.commandId].slice(-32) };
  }
  if (event.type === 'command/done' && typeof d.commandId === 'string' && state.sideCommands.includes(d.commandId)) {
    const sideCommands = state.sideCommands.filter(id => id !== d.commandId);
    if (d.kind === 'error') return { ...state, sideCommands, error: typeof d.text === 'string' && d.text || 'Side command failed.' };
    const result = decodeResult(d.text);
    if (!result || result.parentId !== state.sessionId) return { ...state, sideCommands };
    if (result.action === 'promoted') {
      if (!state.parentId) return { ...state, sideCommands };
      return { ...state, sideCommands, permanent: true, error: null };
    }
    const opensSide = typeof result.action !== 'string' || !['status', 'stop', 'close', 'keep'].includes(result.action);
    const shouldExpand = opensSide && !isInternalCommandId(d.commandId);
    const promotedId = result.action === 'keep' && typeof result.promotedId === 'string' ? result.promotedId
      : opensSide ? null : state.promotedId;
    return { ...state, sideCommands, childId: result.childId, promotedId, revision: state.revision + (shouldExpand ? 1 : 0), error: null };
  }
  if (state.boundary === null) return state;
  if (event.type === 'user/message' || event.type === 'assistant/message') {
    const message = event.type === 'user/message' ? d : d.message;
    const text = textOf(message);
    if (!text || !isRecord(message) || typeof message.id !== 'string') return state;
    const row: TranscriptMessage = { id: message.id, role: event.type === 'user/message' ? 'user' : 'assistant', text };
    return { ...state, messages: [...state.messages, row].slice(-(state.messageLimit ?? 80)) };
  }
  if (event.type === 'turn/start') return { ...state, ended: null };
  if (event.type === 'turn/end' && isRecord(d.reason) && typeof d.reason.kind === 'string') {
    const error = d.reason.error;
    return { ...state, ended: d.reason.kind === 'error' && isRecord(error) && typeof error.message === 'string' ? error.message : d.reason.kind };
  }
  return state;
}
