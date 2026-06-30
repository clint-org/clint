/**
 * Contract test for the bullseye asset detail pane's entity navigation.
 *
 * The unit runner has no Angular compiler, so we pin the template + wiring by
 * source contract (same approach as heatmap-detail-panel.component.spec.ts).
 *
 * Regression: the asset name in the bullseye detail pane was plain, non-
 * clickable text -- unlike the timeline marker detail pane, where the asset,
 * company, and trial are all navigable. This locks in that the asset name is a
 * clickable affordance that emits `openAsset`, and that the parent landscape
 * component routes that to the asset PROFILE (not the timeline).
 * See issue #170.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const here = join(__dirname);
const panelTs = readFileSync(join(here, 'bullseye-detail-panel.component.ts'), 'utf8');
const panelHtml = readFileSync(join(here, 'bullseye-detail-panel.component.html'), 'utf8');
const landscapeTs = readFileSync(join(here, 'landscape.component.ts'), 'utf8');
const landscapeHtml = readFileSync(join(here, 'landscape.component.html'), 'utf8');

describe('bullseye detail pane asset navigation', () => {
  it('exposes an openAsset output and an onAssetClick handler that emits the asset id', () => {
    expect(panelTs).toContain('readonly openAsset = output<string>();');
    expect(panelTs).toContain('onAssetClick(');
    // Emits the selected asset's id, mirroring onCompanyClick's shape.
    expect(panelTs).toMatch(/onAssetClick\(\)[\s\S]*?this\.openAsset\.emit\(p\.id\)/);
  });

  it('renders the asset name as a clickable affordance, not plain text', () => {
    // The name must live inside a button bound to onAssetClick, not bare in the h2.
    expect(panelHtml).toContain('(click)="onAssetClick()"');
    expect(panelHtml).toMatch(/onAssetClick\(\)"[\s\S]*?\{\{ asset\.name \}\}/);
    // Regression: the name must no longer be rendered as bare heading text.
    expect(panelHtml).not.toContain(
      '<h2 class="text-[19px] font-bold leading-tight text-slate-900">{{ asset.name }}</h2>',
    );
  });

  it('wires the parent to listen for openAsset', () => {
    expect(landscapeHtml).toContain('(openAsset)="onOpenAsset($event)"');
  });

  it('routes openAsset to the asset profile and not to the timeline', () => {
    const body = landscapeTs.match(/onOpenAsset\(assetId: string\): void \{([\s\S]*?)\n {2}\}/)?.[1];
    expect(body, 'onOpenAsset method not found').toBeTruthy();
    expect(body).toMatch(/'profiles',\s*'assets',\s*assetId/);
    // Regression: the asset link must reach the profile, never the timeline
    // (cf. heatmap-detail-panel, where an openAsset->timeline link was removed).
    expect(body).not.toContain("'timeline'");
  });
});
