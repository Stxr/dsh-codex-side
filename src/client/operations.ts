import { errorMessage, isRecord } from '../shared/protocol';
import type { ClientContext, PromoteAndOpen, Translate } from './host';
import { TAB_KIND } from './presentation';
import { projectionSource, readProjection } from './projections';
import type { SideState } from './state';

/** The remote command result is an untrusted transport value. */
function commandValue(result: unknown, unavailable: string): Record<string, unknown> {
  if (!isRecord(result)) throw new Error(unavailable);
  if (result.ok !== true) {
    const error = isRecord(result.error) ? result.error.message : result.error;
    throw new Error(error === undefined ? unavailable : errorMessage(error));
  }
  const value = result.value;
  if (!isRecord(value) || !isRecord(value.result)) throw new Error(unavailable);
  if (value.result.kind === 'error') {
    throw new Error(typeof value.result.text === 'string' ? value.result.text : unavailable);
  }
  return value;
}

export function createSideOperations(ctx: ClientContext, t: Translate, state: SideState) {
  async function command(sessionId: string, line: string): Promise<Record<string, unknown>> {
    state.clearFailure(sessionId);
    const binding = ctx.sessions.binding(sessionId);
    if (!binding) throw new Error(t('unavailable'));
    const result = await binding.ctx.remote.commands.execute(line, [], new AbortController().signal);
    return commandValue(result, t('unavailable'));
  }

  function reveal(parentId: string): void {
    if (ctx.sidebarRight.mounted.getSnapshot() !== parentId) return;
    const existing = ctx.sidebarRight.openTabs.getSnapshot()
      .find(tab => tab.sessionId === parentId && tab.kind === TAB_KIND);
    if (existing) {
      ctx.sidebarRight.focus(existing.tabId);
      if (!ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded();
    } else {
      ctx.sidebarRight.openTab(TAB_KIND);
    }
  }

  const promoteAndOpen: PromoteAndOpen = async (parentId, childId, tab) => {
    await command(parentId, `/side --keep ${childId}`);
    await ctx.sessions.refresh();
    // A manual close, another side, or a later selection supersedes this UI
    // handoff. Tab actions remain scoped to their original occurrence.
    if (tab.signal.aborted) return;
    const currentChild = readProjection(projectionSource(ctx.sessions.binding(parentId)).getSnapshot()).childId;
    if (currentChild && currentChild !== childId) return;
    const foreground = ctx.sidebarRight.mounted.getSnapshot() === parentId;
    const reference = ctx.sessions.retain(childId, { source: 'controllerOperation' });
    state.promotionClosures.add(parentId);
    try {
      tab.actions.close();
      if (foreground) ctx.uiWorkspace.openSession(childId);
    } finally {
      state.promotionClosures.delete(parentId);
      reference.release();
    }
  };

  function closeSide(parentId: string): void {
    if (state.promotionClosures.has(parentId)) return;
    const childId = readProjection(projectionSource(ctx.sessions.binding(parentId)).getSnapshot()).childId;
    if (!childId) return;
    const reference = ctx.sessions.retain(parentId, { source: 'controllerOperation' });
    command(parentId, '/side --close')
      .catch((error: unknown) => state.reportFailure(parentId, error))
      .finally(() => reference.release());
  }

  return { command, reveal, promoteAndOpen, closeSide };
}

export type SideOperations = ReturnType<typeof createSideOperations>;
