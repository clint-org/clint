/**
 * Contract tests for the "locked asset" affordance on the trial create dialog,
 * used when the dialog is opened from an asset's detail page.
 *
 * The unit runner is a plain node environment (no Angular compiler), so we pin
 * the wiring by source assertion -- the same approach pi-mark.component.spec.ts
 * uses. Rendered behaviour is exercised by the asset-detail surface that hosts
 * the dialog.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ts = readFileSync(join(__dirname, 'trial-create-dialog.component.ts'), 'utf8');
const html = readFileSync(join(__dirname, 'trial-create-dialog.component.html'), 'utf8');

describe('trial create dialog: locked asset', () => {
  it('exposes a lockedAssetId input', () => {
    expect(ts).toContain('readonly lockedAssetId = input<string | null>(null)');
  });

  it('derives assetLocked from the locked input', () => {
    expect(ts).toContain('assetLocked = computed(() => !!this.lockedAssetId())');
  });

  it('forces the selection to the locked asset', () => {
    expect(ts).toMatch(/const locked = this\.lockedAssetId\(\);\s*if \(locked\) this\.assetId\.set/);
  });

  it('resets the asset to the locked value (not null) when the dialog closes', () => {
    // Regression guard: a plain reset to null would drop the lock if the dialog
    // is reopened from the asset page while still mounted.
    expect(ts).toContain('this.assetId.set(this.lockedAssetId())');
    expect(ts).not.toContain('this.assetId.set(null)');
  });

  it('disables the asset picker while locked', () => {
    expect(html).toContain('[disabled]="assetLocked()"');
  });
});
