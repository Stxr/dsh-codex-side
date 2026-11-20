import { SessionSeq } from '@deepseek-ai/dsh-session';
import type { TitleGeneration } from '../shared/protocol.js';
import type { HostAgent, TitleContext } from './types.js';
/** 只在用户明确转换时读取 ownEvents；surface 和现存 inbox 排除已删/已取消输入。 */
export declare function lastSideQuestion(agent: Pick<HostAgent, 'inbox' | 'session'>): {
    seq: SessionSeq;
    text: string;
    pending: boolean;
} | null;
export declare function titleInput(question: string): string;
export declare function retitleSide(ctx: TitleContext, agent: HostAgent, signal: AbortSignal): Promise<TitleGeneration>;
