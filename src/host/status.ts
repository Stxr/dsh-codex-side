import { isRecord } from '../shared/protocol.js';
import type { TranscriptMessage } from '../shared/protocol.js';

/** Controller projection 是跨边界数据，按字段读取并保留旧版本的截断标志。 */
export function readTranscript(value: unknown): { ended: string | null; messages: TranscriptMessage[] } {
  if (!isRecord(value)) return { ended: null, messages: [] };
  const rows: unknown[] = Array.isArray(value.messages) ? value.messages : [];
  const messages = rows.flatMap((row): TranscriptMessage[] => {
    if (!isRecord(row) || typeof row.id !== 'string' || (row.role !== 'user' && row.role !== 'assistant') || typeof row.text !== 'string') return [];
    return [{ id: row.id, role: row.role, text: row.text.slice(0, 6000), truncated: Boolean(row.truncated) || row.text.length > 6000 }];
  }).slice(-4);
  return { messages, ended: typeof value.ended === 'string' ? value.ended : null };
}
