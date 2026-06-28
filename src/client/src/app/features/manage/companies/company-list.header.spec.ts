import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('companies list: header moved into content', () => {
  const ts = readFileSync(join(__dirname, 'company-list.component.ts'), 'utf8');
  const html = readFileSync(join(__dirname, 'company-list.component.html'), 'utf8');

  it('renders a content section-header labelled Companies', () => {
    expect(html).toContain('app-section-header');
    expect(html).toContain('label="Companies"');
  });

  it('projects the Add company action into the header, gated by canEdit', () => {
    expect(html).toContain('actions');
    expect(html).toContain('Add company');
    expect(html).toContain('canEdit()');
  });

  it('no longer pushes actions or record count into the topbar', () => {
    expect(ts).not.toContain('topbarState.actions.set');
    expect(ts).not.toContain('topbarState.recordCount.set');
  });
});
