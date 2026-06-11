import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The unit runner is a plain node environment, so rendered-dialog behavior
// (options hidden for png, copy visible, export round-trip) is asserted in
// e2e/tests/export.spec.ts. These source assertions pin the contract that
// test and PngExportService rely on.
describe('export dialog png snapshot contract', () => {
  const src = readFileSync(join(__dirname, 'export-dialog.component.ts'), 'utf8');

  it('gates the deck options on the pptx format', () => {
    expect(src).toContain('@if (showsPptxOptions())');
    expect(src).toContain("computed(() => this.format() === 'pptx')");
  });

  it('explains capture-as-is when options are hidden', () => {
    expect(src).toContain('The image matches the timeline exactly as shown on screen');
  });

  it('builds the png snapshot from the live grid state, not dialog options', () => {
    for (const field of [
      'zoomLevel: this.liveZoomLevel()',
      'hideCompanyColumn: this.hideCompanyColumn()',
      'hideAssetColumn: this.hideAssetColumn()',
      'hideTrialColumn: this.hideTrialColumn()',
      'hideMoaColumn: this.hideMoaColumn()',
      'hideRoaColumn: this.hideRoaColumn()',
      'hideNotesColumn: this.hideNotesColumn()',
      'spaceId: this.spaceId()',
    ]) {
      expect(src).toContain(field);
    }
    expect(src).toContain('this.pngService.exportDashboard(snapshot, this.injector)');
  });

  it('keeps the dialog-selected zoom for pptx only', () => {
    expect(src).toContain('zoomLevel: this.selectedZoom()');
  });
});
