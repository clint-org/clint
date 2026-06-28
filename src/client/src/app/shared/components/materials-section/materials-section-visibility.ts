/**
 * Visibility rule for the entity-level Materials section, extracted as a pure
 * function so it can be unit-tested without mounting the component (the unit
 * suite runs in a node environment with no DOM).
 *
 * A host opts a transient detail pane (e.g. the marker or event drawer) out of
 * showing an empty Materials block via `hideWhenEmpty`. The block collapses to
 * nothing once the fetch settles with no materials AND the viewer cannot upload
 * -- a read-only viewer is spared a dead empty box. An editor who *can* upload
 * still sees the (empty) section so they can register the first material; the
 * drop zone is their only entry point on that surface. While loading or on
 * error the block always renders so the user is never left with a silent gap.
 */
export interface MaterialsSectionVisibilityState {
  hideWhenEmpty: boolean;
  loading: boolean;
  error: boolean;
  isEmpty: boolean;
  canUpload: boolean;
}

export function materialsSectionHidden(state: MaterialsSectionVisibilityState): boolean {
  return (
    state.hideWhenEmpty &&
    !state.loading &&
    !state.error &&
    state.isEmpty &&
    !state.canUpload
  );
}
