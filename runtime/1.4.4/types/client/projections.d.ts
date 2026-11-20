import type { SideMetadata } from '../shared/protocol';
import type { ExternalStore, SessionBinding } from './host';
/** Historical checkpoints and a binding being opened can expose partial metadata. */
export type SideProjection = Omit<SideMetadata, 'sessionId'> & {
    sessionId: string | undefined;
};
export declare const EMPTY_PROJECTION: Readonly<SideProjection>;
export declare const EMPTY_SOURCE: ExternalStore<unknown>;
/** Decode after reading the external store so its snapshot identity stays intact. */
export declare function readProjection(value: unknown): Readonly<SideProjection>;
export declare function projectionSource(binding: SessionBinding | undefined): ExternalStore<unknown>;
/** Read only local summary visibility; do not open or retain catalogue entries. */
export declare function missingProjectionIds(value: unknown): string[];
