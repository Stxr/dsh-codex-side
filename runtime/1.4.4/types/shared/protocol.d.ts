/** 宿主、历史投影及 Client 共用的稳定协议；不依赖 DSH 服务。 */
export declare const PLUGIN_NAME = "@local/dsh-codex-side";
export declare const KEY = "local.codexSide.v1";
export declare const TRANSCRIPT_KEY = "local.codexSide.transcript.v1";
export declare const MARKER = "DSH_SIDE_BOUNDARY_V1 ";
export declare const RESULT = "DSH_SIDE_RESULT_V1\n";
export declare const isInternalCommandId: (id: unknown) => id is string;
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare const errorMessage: (error: unknown) => string;
export type SideAction = 'open' | 'ask' | 'new' | 'close' | 'stop' | 'status' | 'keep';
export interface SideRequest {
    action: SideAction;
    question?: string;
    childId?: string;
}
export interface TranscriptMessage {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    truncated?: boolean;
}
export interface SideMetadata {
    sessionId: string;
    parentId: string | null;
    childId: string | null;
    permanent: boolean;
    promotedId: string | null;
    revision: number;
    error: string | null;
    ended: string | null;
}
export interface SideState extends SideMetadata {
    inheritedEventCount: number;
    sideCommands: string[];
    messages: TranscriptMessage[];
    boundary: number | null;
    messageLimit?: number;
}
export interface TitleGeneration {
    status: 'unchanged' | 'preserved' | 'ai' | 'fallback';
    title?: string;
}
/** 旧日志允许省略 action，回放时沿用旧版本的展开语义。 */
export interface SideResult {
    parentId: string;
    childId: string | null;
    action?: string;
    promotedId?: string;
    permanent?: boolean;
    titleGeneration?: TitleGeneration;
    running?: boolean;
    pendingInput?: unknown;
    messages?: TranscriptMessage[];
    ended?: string | null;
    created?: boolean;
}
export interface SideEvent {
    type: string;
    seq: number;
    time?: number;
    data: unknown;
}
