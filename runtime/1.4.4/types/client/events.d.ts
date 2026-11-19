import type { InternalCommandDefinition } from './host';
/**
 * Native internal command records commit recovery state, not a second human
 * invocation. Claim just our IDs, including done-only historical Chat windows.
 */
export declare function internalCommandDefinition(): InternalCommandDefinition;
