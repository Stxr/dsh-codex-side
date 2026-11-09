import { isRecord, KEY } from '../shared/protocol';
import type { SideMetadata } from '../shared/protocol';
import type { ExternalStore, SessionBinding } from './host';

/** Historical checkpoints and a binding being opened can expose partial metadata. */
export type SideProjection = Omit<SideMetadata, 'sessionId'> & { sessionId: string | undefined };

export const EMPTY_PROJECTION: Readonly<SideProjection> = Object.freeze({
  sessionId: undefined,
  parentId: null,
  childId: null,
  permanent: false,
  promotedId: null,
  revision: 0,
  error: null,
  ended: null,
});

export const EMPTY_SOURCE: ExternalStore<unknown> = {
  subscribe: () => () => {},
  getSnapshot: () => EMPTY_PROJECTION,
};

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Decode after reading the external store so its snapshot identity stays intact. */
export function readProjection(value: unknown): Readonly<SideProjection> {
  if (!isRecord(value)) return EMPTY_PROJECTION;
  return {
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : undefined,
    parentId: nullableString(value.parentId),
    childId: nullableString(value.childId),
    permanent: value.permanent === true,
    promotedId: nullableString(value.promotedId),
    revision: typeof value.revision === 'number' ? value.revision : 0,
    error: nullableString(value.error),
    ended: nullableString(value.ended),
  };
}

export function projectionSource(binding: SessionBinding | undefined): ExternalStore<unknown> {
  return binding?.session.projections.faceOf(KEY) ?? EMPTY_SOURCE;
}

/** Read only local summary visibility; do not open or retain catalogue entries. */
export function missingProjectionIds(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.ids)) return [];
  const byId = isRecord(value.byId) ? value.byId : {};
  return value.ids.filter((id: unknown): id is string => {
    if (typeof id !== 'string' || !/^side-[0-9a-f-]{36}$/i.test(id)) return false;
    const summary = byId[id];
    const projectionValues = isRecord(summary) && isRecord(summary.projectionValues)
      ? summary.projectionValues : undefined;
    return !projectionValues?.[KEY];
  });
}
