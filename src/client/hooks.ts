import type { ClientContext, ExternalStore, ReactRuntime, SessionBinding } from './host';
import { EMPTY_SOURCE, projectionSource, readProjection } from './projections';
import type { SideState } from './state';

export function createSideHooks(ctx: ClientContext, React: ReactRuntime, state: SideState) {
  function useLocale(): void {
    React.useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => ctx.locale.getSnapshot());
  }

  function useSource<Value>(source: ExternalStore<Value>): Value;
  function useSource(source?: ExternalStore<unknown>): unknown;
  function useSource(source: ExternalStore<unknown> = EMPTY_SOURCE): unknown {
    return React.useSyncExternalStore(listener => source.subscribe(listener), () => source.getSnapshot());
  }

  function useProjection(binding: SessionBinding | undefined) {
    const source = React.useMemo(() => projectionSource(binding), [binding]);
    return readProjection(useSource(source));
  }

  function useFailure(sessionId: string): string {
    return React.useSyncExternalStore(state.subscribeFailures, () => state.failure(sessionId));
  }

  return { useLocale, useSource, useProjection, useFailure };
}

export type SideHooks = ReturnType<typeof createSideHooks>;
