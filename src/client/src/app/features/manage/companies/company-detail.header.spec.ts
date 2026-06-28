import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('company detail: header + actions in content', () => {
  const ts = readFileSync(join(__dirname, 'company-detail.component.ts'), 'utf8');
  const html = readFileSync(join(__dirname, 'company-detail.component.html'), 'utf8');

  it('renders a white-card detail header instead of the section-header component', () => {
    expect(html).toContain('border border-slate-200 bg-white');
    expect(html).not.toContain('app-section-header');
  });

  it('renders Add asset and the entity kebab in the header', () => {
    expect(html).toContain('Add asset');
    expect(html).toContain('app-row-actions');
    expect(html).toContain('spaceRole.canEdit()');
  });

  it('builds the entity menu locally instead of pushing to the topbar', () => {
    expect(ts).toContain('buildEntityActionMenu');
    expect(ts).not.toContain('topbarState.overflowActions.set');
    expect(ts).not.toContain('topbarState.actions.set');
  });
});
