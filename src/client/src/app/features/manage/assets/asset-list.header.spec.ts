import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('assets list: header moved into content', () => {
  const ts = readFileSync(join(__dirname, 'asset-list.component.ts'), 'utf8');
  const html = readFileSync(join(__dirname, 'asset-list.component.html'), 'utf8');

  it('renders a content section-header labelled Assets', () => {
    expect(html).toContain('app-section-header');
    expect(html).toContain('label="Assets"');
  });

  it('projects the Add asset action into the header, gated by canEdit', () => {
    expect(html).toContain('actions');
    expect(html).toContain('Add asset');
    expect(html).toContain('canEdit()');
  });

  it('no longer pushes actions or record count into the topbar', () => {
    expect(ts).not.toContain('topbarState.actions.set');
    expect(ts).not.toContain('topbarState.recordCount.set');
  });
});
