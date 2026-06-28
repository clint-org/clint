import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('app-shell pageType: profiles detail uses the tabbed topbar', () => {
  const src = readFileSync(join(__dirname, 'app-shell.component.ts'), 'utf8');

  it('no longer special-cases trial detail to the detail pageType', () => {
    // The old snowflake matched profiles/trials/:id and returned 'detail'.
    expect(src).not.toContain("route.match(/^profiles\\/trials\\/[^/]+$/)");
  });

  it('still routes profiles/* through the landscape (tabbed) branch', () => {
    expect(src).toContain("route.startsWith('profiles/')");
  });
});
