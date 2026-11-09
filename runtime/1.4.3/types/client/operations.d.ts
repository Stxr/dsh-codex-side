import type { ClientContext, PromoteAndOpen, Translate } from './host';
import type { SideState } from './state';
export declare function createSideOperations(ctx: ClientContext, t: Translate, state: SideState): {
    command: (sessionId: string, line: string) => Promise<Record<string, unknown>>;
    reveal: (parentId: string) => void;
    promoteAndOpen: PromoteAndOpen;
    closeSide: (parentId: string) => void;
};
export type SideOperations = ReturnType<typeof createSideOperations>;
