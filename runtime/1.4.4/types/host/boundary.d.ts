import type { SessionEvent } from '@deepseek-ai/dsh-session';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'local-codex-side': {
            kind: 'local-codex-side';
        };
    }
}
/** 循环构造时缓存最后回合，因此必须在 setup 之前把完整边界回合放进 seed。 */
export declare function withSideBoundary(seed: readonly SessionEvent[], parentId: string, messageId: string, time?: number): SessionEvent[];
