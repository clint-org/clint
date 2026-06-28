import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('asset detail: header + actions in content', () => {
  const ts = readFileSync(join(__dirname, 'asset-detail.component.ts'), 'utf8');
  const html = readFileSync(join(__dirname, 'asset-detail.component.html'), 'utf8');

  it('uses the detail-variant section-header', () => {
    expect(html).toContain('app-section-header');
    expect(html).toContain('variant="detail"');
  });

  it('keeps the company crumb link in the eyebrow slot', () => {
    expect(html).toContain('eyebrow');
    expect(html).toContain("'companies'");
  });

  it('renders the entity kebab in the header and stops pushing to the topbar', () => {
    expect(html).toContain('app-row-actions');
    expect(ts).not.toContain('topbarState.overflowActions.set');
    expect(ts).not.toContain('topbarState.entityTitle.set');
  });
});
