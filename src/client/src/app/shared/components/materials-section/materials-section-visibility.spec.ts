import { describe, expect, it } from 'vitest';

import {
  materialsSectionHidden,
  MaterialsSectionVisibilityState,
} from './materials-section-visibility';

/** Settled, empty, read-only viewer with hideWhenEmpty on -- the hide case. */
function base(): MaterialsSectionVisibilityState {
  return { hideWhenEmpty: true, loading: false, error: false, isEmpty: true, canUpload: false };
}

describe('materialsSectionHidden', () => {
  it('hides a settled, empty, read-only pane when hideWhenEmpty is set', () => {
    expect(materialsSectionHidden(base())).toBe(true);
  });

  it('keeps the empty section for an editor who can upload (regression: first-upload entry point)', () => {
    // The drawer drop zone is the editor's only way to add the first material,
    // so the empty section must stay visible for them even with hideWhenEmpty.
    expect(materialsSectionHidden({ ...base(), canUpload: true })).toBe(false);
  });

  it('never hides when hideWhenEmpty is off (entity detail pages keep the zone)', () => {
    expect(materialsSectionHidden({ ...base(), hideWhenEmpty: false })).toBe(false);
  });

  it('does not hide while loading, so the user is never left with a silent gap', () => {
    expect(materialsSectionHidden({ ...base(), loading: true })).toBe(false);
  });

  it('does not hide on error, so the failure is shown rather than swallowed', () => {
    expect(materialsSectionHidden({ ...base(), error: true })).toBe(false);
  });

  it('does not hide when materials exist', () => {
    expect(materialsSectionHidden({ ...base(), isEmpty: false })).toBe(false);
  });
});
