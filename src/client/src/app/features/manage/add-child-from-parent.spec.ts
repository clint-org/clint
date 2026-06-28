/**
 * Contract tests for the "add a child entity from its parent's page" affordance:
 *   - Asset detail page  -> Add trial   (asset pre-locked)
 *   - Company detail page -> Add asset  (company pre-locked)
 *
 * Pinned by source assertion (plain node runner, no Angular compiler), matching
 * the repo convention in pi-mark.component.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');

describe('asset detail: add trial', () => {
  const ts = read('assets/asset-detail.component.ts');
  const html = read('assets/asset-detail.component.html');

  it('publishes an "Add trial" primary action only when the user can edit', () => {
    // Button lives in the white-card detail header, not the topbar.
    expect(html).toContain('label="Add trial"');
    // Gated by canEdit in the template.
    expect(html).toContain('@if (spaceRole.canEdit())');
    // Button is inside the right-aligned actions cluster.
    expect(html).toMatch(/shrink-0 items-center gap-2[\s\S]*label="Add trial"/);
  });

  it('hosts the trial dialog with this asset locked', () => {
    expect(html).toContain('<app-trial-create-dialog');
    expect(html).toContain('[lockedAssetId]="p.id"');
  });

  it('navigates to the new trial after creation', () => {
    expect(ts).toContain('onTrialCreated({ trialId }: { trialId: string })');
    expect(ts).toMatch(/'profiles',\s*'trials',\s*trialId/);
  });
});

describe('company detail: add asset', () => {
  const ts = read('companies/company-detail.component.ts');
  const html = read('companies/company-detail.component.html');

  it('publishes an "Add asset" primary action only when the user can edit', () => {
    // Button lives in the white-card detail header, not the topbar.
    expect(html).toContain('label="Add asset"');
    // Gated by canEdit in the template.
    expect(html).toContain('@if (spaceRole.canEdit())');
    // Button is inside the right-aligned actions cluster.
    expect(html).toMatch(/shrink-0 items-center gap-2[\s\S]*label="Add asset"/);
  });

  it('hosts the asset form with this company locked', () => {
    expect(html).toContain('<app-asset-form');
    expect(html).toContain('[lockedCompanyId]="c.id"');
  });

  it('navigates to the new asset after creation', () => {
    expect(ts).toContain('onAssetCreated(asset: Asset)');
    expect(ts).toMatch(/'profiles',\s*'assets',\s*asset\.id/);
  });

});
