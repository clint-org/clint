import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('company detail: header + actions in content', () => {
  const ts = readFileSync(join(__dirname, 'company-detail.component.ts'), 'utf8');
  const html = readFileSync(join(__dirname, 'company-detail.component.html'), 'utf8');

  it('uses the detail-variant section-header', () => {
    expect(html).toContain('app-section-header');
    expect(html).toContain('variant="detail"');
  });

  it('renders Add asset and the entity kebab in the header actions slot', () => {
    expect(html).toContain('Add asset');
    expect(html).toContain('app-row-actions');
  });

  it('builds the entity menu locally instead of pushing to the topbar', () => {
    expect(ts).toContain('buildEntityActionMenu');
    expect(ts).not.toContain('topbarState.overflowActions.set');
    expect(ts).not.toContain('topbarState.actions.set');
  });
});
