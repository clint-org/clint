import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The attributes are load-bearing for PngExportService: it polls for the
// absence of [data-export-waiting] before capturing and filters
// [data-export-exclude] nodes out of the image. Template-text assertions
// keep them from being refactored away silently.
describe('legend export hooks', () => {
  const html = readFileSync(join(__dirname, 'legend.component.html'), 'utf8');

  it('marks the loading block so the export can wait for marker types', () => {
    expect(html).toContain('data-export-waiting');
  });

  it('marks the help links container for exclusion from captures', () => {
    expect(html).toContain('data-export-exclude');
  });
});
