import { MessageId } from '@deepseek-ai/dsh-llm';
import { SessionSeq } from '@deepseek-ai/dsh-session';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { MARKER } from '../shared/protocol.js';
import { SIDE_POLICY } from '../shared/policy.js';

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap { 'local-codex-side': { kind: 'local-codex-side' } }
}

/** 循环构造时缓存最后回合，因此必须在 setup 之前把完整边界回合放进 seed。 */
export function withSideBoundary(seed: readonly SessionEvent[], parentId: string, messageId: string, time = Date.now()): SessionEvent[] {
  const next = [...seed];
  let turn = 0;
  for (const event of seed) if (event.type === 'turn/start') turn = Math.max(turn, event.data.turn);
  turn += 1;
  next.push({ type: 'turn/start', seq: SessionSeq(next.length), time, data: { turn } });
  next.push({ type: 'step/start', seq: SessionSeq(next.length), time, data: { turn, step: 1 } });
  next.push({ type: 'developer/message', seq: SessionSeq(next.length), time, data: {
    turn, step: 1,
    message: { id: MessageId(messageId), role: 'developer', source: { kind: 'local-codex-side' },
      content: [{ type: 'text', text: MARKER + JSON.stringify({ parentId }) + '\n' + SIDE_POLICY }] },
  }, surfaceOp: 'append' });
  next.push({ type: 'step/end', seq: SessionSeq(next.length), time, data: { turn, step: 1 } });
  next.push({ type: 'turn/end', seq: SessionSeq(next.length), time, data: { turn, reason: { kind: 'completed' } } });
  return next;
}
