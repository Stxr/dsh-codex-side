import { isInternalCommandId, isRecord } from '../shared/protocol';
import type { InternalCommandDefinition } from './host';

/**
 * Native internal command records commit recovery state, not a second human
 * invocation. Claim just our IDs, including done-only historical Chat windows.
 */
export function internalCommandDefinition(): InternalCommandDefinition {
  return {
    kind: 'codex-side-internal-command',
    target: 'chat',
    match(event: unknown) {
      if (!isRecord(event) || (event.type !== 'command/run' && event.type !== 'command/done')) return null;
      if (!isRecord(event.data)) return null;
      const id = event.data.commandId;
      if (typeof id !== 'string' || !isInternalCommandId(id)) return null;
      return { id, role: event.type === 'command/run' ? 'start' : 'update', exclusive: true };
    },
    start: () => ({}),
    update: context => context.state,
    buildViewNode: () => null,
  };
}
