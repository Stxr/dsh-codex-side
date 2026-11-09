import { errorMessage } from '../shared/protocol';
import type { ClientContext, Dispose, Listener } from './host';
import { missingProjectionIds } from './projections';

interface SeenProjection {
  readonly childId: string | null;
  readonly revision: number;
}

/** Owned by one apply call, never shared across plugin lifetimes. */
export function createSideState() {
  const failures = new Map<string, string>();
  const failureListeners = new Set<Listener>();

  function notifyFailures(): void {
    for (const listener of failureListeners) listener();
  }

  return {
    promotionClosures: new Set<string>(),
    seen: new Map<string, SeenProjection>(),
    subscribeFailures(listener: Listener): Dispose {
      failureListeners.add(listener);
      return () => { failureListeners.delete(listener); };
    },
    failure(sessionId: string): string {
      return failures.get(sessionId) ?? '';
    },
    reportFailure(sessionId: string, error: unknown): void {
      failures.set(sessionId, errorMessage(error));
      notifyFailures();
    },
    clearFailure(sessionId: string): void {
      if (failures.delete(sessionId)) notifyFailures();
    },
  };
}

export type SideState = ReturnType<typeof createSideState>;

/**
 * Older checkpoints may lack summary metadata. Refresh just those projections,
 * at most four at once, without retaining/resuming Agents or reading Client logs.
 */
export function observeMissingProjections(ctx: ClientContext, state: SideState): Dispose {
  const list = ctx.sessions.list;
  if (!list) return () => {};
  const attempted = new Set<string>();
  const queue: string[] = [];
  let live = true;
  let running = 0;

  function pump(): void {
    while (live && running < 4 && queue.length > 0) {
      const id = queue.shift();
      if (id === undefined) break;
      running += 1;
      ctx.sessions.refreshProjections(id).catch((error: unknown) => {
        if (!live) return;
        const parentId = ctx.sidebarRight.mounted.getSnapshot();
        if (parentId) state.reportFailure(parentId, error);
      }).finally(() => {
        running -= 1;
        pump();
      });
    }
  }

  const discover = (): void => {
    for (const id of missingProjectionIds(list.getSnapshot())) {
      if (attempted.has(id)) continue;
      attempted.add(id);
      queue.push(id);
    }
    pump();
  };

  const dispose = list.subscribe(discover);
  discover();
  return () => {
    live = false;
    queue.length = 0;
    dispose();
  };
}
