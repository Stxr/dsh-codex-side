import type { SideEvent, SideMetadata, SideState, TranscriptMessage } from './protocol.js';
export declare function initState(header: {
    id: string;
}, inheritedEventCount?: number): SideState;
export declare function metadataView(state: SideState): SideMetadata;
export declare const initTranscriptState: (header: {
    id: string;
}, inheritedEventCount?: number) => SideState;
export declare const transcriptView: (state: SideState) => {
    ended: string | null;
    messages: TranscriptMessage[];
};
/** 保持 v4 checkpoint 形状及内部命令不展开侧栏的旧语义。 */
export declare function fold(state: SideState, event: SideEvent): SideState;
