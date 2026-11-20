import type { TranscriptMessage } from '../shared/protocol.js';
/** Controller projection 是跨边界数据，按字段读取并保留旧版本的截断标志。 */
export declare function readTranscript(value: unknown): {
    ended: string | null;
    messages: TranscriptMessage[];
};
