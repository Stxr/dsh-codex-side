import type { ClientContext, ExternalStore, ReactRuntime, SessionBinding } from './host';
import type { SideState } from './state';
export declare function createSideHooks(ctx: ClientContext, React: ReactRuntime, state: SideState): {
    useLocale: () => void;
    useSource: {
        <Value>(source: ExternalStore<Value>): Value;
        (source?: ExternalStore<unknown>): unknown;
    };
    useProjection: (binding: SessionBinding | undefined) => Readonly<import("./projections").SideProjection>;
    useFailure: (sessionId: string) => string;
};
export type SideHooks = ReturnType<typeof createSideHooks>;
