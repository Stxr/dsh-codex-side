import type { ClientContext, Dispose, Listener } from './host';
interface SeenProjection {
    readonly childId: string | null;
    readonly revision: number;
}
/** Owned by one apply call, never shared across plugin lifetimes. */
export declare function createSideState(): {
    promotionClosures: Set<string>;
    seen: Map<string, SeenProjection>;
    subscribeFailures(listener: Listener): Dispose;
    failure(sessionId: string): string;
    reportFailure(sessionId: string, error: unknown): void;
    clearFailure(sessionId: string): void;
};
export type SideState = ReturnType<typeof createSideState>;
/**
 * Older checkpoints may lack summary metadata. Refresh just those projections,
 * at most four at once, without retaining/resuming Agents or reading Client logs.
 */
export declare function observeMissingProjections(ctx: ClientContext, state: SideState): Dispose;
export {};
