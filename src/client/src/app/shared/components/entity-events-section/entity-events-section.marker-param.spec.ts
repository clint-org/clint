import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Regression: the marker EDIT flow round-trips through the `?marker=<id>` query
 * param -- the read-only drawer's "Edit" navigates to the anchor profile with
 * `?marker=<id>`, and EntityEventsSectionComponent opens the merged dialog off
 * that param. The param must be stripped when the dialog closes (cancel OR
 * save), otherwise re-editing the SAME marker re-navigates to an identical URL,
 * which emits no route change, so the deep-link effect never re-opens the
 * dialog -- the "edit window won't show" on the second edit.
 *
 * Source-text (not TestBed) because the component needs the Playwright unit
 * config to mount; mirrors trial-detail.events-edit.spec.ts.
 */
describe('entity events section: closing the edit dialog clears ?marker', () => {
  const ts = readFileSync(
    join(__dirname, 'entity-events-section.component.ts'),
    'utf8'
  );

  it('clearMarkerParam strips the marker param via a merge navigation', () => {
    expect(ts).toContain('clearMarkerParam');
    expect(ts).toMatch(/queryParams:\s*\{\s*marker:\s*null\s*\}/);
    expect(ts).toContain("queryParamsHandling: 'merge'");
  });

  it('clears the marker param when the dialog closes, not only on save', () => {
    const effectBlock = ts.match(/eventDialogResetEffect\s*=\s*effect\([\s\S]*?\}\);/);
    expect(effectBlock, 'eventDialogResetEffect block not found').toBeTruthy();
    // The close/reset path (dialog no longer open) must strip ?marker so the
    // same marker can be re-edited; without this the second edit is a dead click.
    expect(effectBlock![0]).toContain('clearMarkerParam');
  });
});
