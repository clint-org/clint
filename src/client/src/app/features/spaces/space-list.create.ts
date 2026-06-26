import { Space } from '../../core/models/space.model';

/**
 * The list component caches the space list and the accessible-id set as
 * snapshots taken on load (loadData). After create_space returns, the caller
 * is guaranteed to be the space owner -- the RPC inserts the owner
 * space_members row atomically -- so both snapshots must be folded forward
 * before openSpace() runs. Without this, canOpen() reads a stale accessible
 * set that lacks the new id and openSpace() falsely reports "No access to this
 * space" on a space the user just created.
 */
export interface SpaceListSnapshot {
  spaces: Space[];
  accessibleIds: Set<string>;
}

export function foldCreatedSpace(state: SpaceListSnapshot, created: Space): SpaceListSnapshot {
  return {
    // listSpaces orders by created_at ascending; the new space is the newest,
    // so appending keeps the displayed order consistent.
    spaces: [...state.spaces, created],
    accessibleIds: new Set(state.accessibleIds).add(created.id),
  };
}
