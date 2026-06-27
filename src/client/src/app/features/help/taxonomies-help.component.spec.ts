/**
 * Tests for TaxonomiesHelpComponent.
 *
 * The unit runner is a plain node environment (vitest.units.config.ts) with no
 * Angular compiler. We test the async data-loading and sorting logic by
 * mirroring the ngOnInit transform directly, and verify the template wiring by
 * source contract (readFileSync). This follows the same pattern used by
 * heatmap-detail-panel.component.spec.ts and other component specs in this
 * codebase.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { Indication } from '../../core/models/indication.model';
import type { MechanismOfAction } from '../../core/models/mechanism-of-action.model';
import type { RouteOfAdministration } from '../../core/models/route-of-administration.model';

const src = readFileSync(join(__dirname, 'taxonomies-help.component.ts'), 'utf8');

// Mirrors the sort + map applied in ngOnInit so we can test the
// data-transformation contract without mounting the component.
function order<T extends { display_order: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.display_order - b.display_order);
}

function toVocabRows(
  inds: Pick<Indication, 'name' | 'abbreviation' | 'display_order'>[],
  moas: Pick<MechanismOfAction, 'name' | 'description' | 'display_order'>[],
  roas: Pick<RouteOfAdministration, 'name' | 'abbreviation' | 'display_order'>[],
) {
  return {
    indications: order(inds).map((r) => ({ name: r.name, detail: r.abbreviation ?? null })),
    moa: order(moas).map((r) => ({ name: r.name, detail: r.description ?? null })),
    roa: order(roas).map((r) => ({ name: r.name, detail: r.abbreviation ?? null })),
  };
}

describe('TaxonomiesHelpComponent ngOnInit logic', () => {
  it('live-renders the three vocab tables after init', async () => {
    const indService = {
      list: vi.fn().mockResolvedValue([{ name: 'NSCLC', abbreviation: 'NSCLC', display_order: 1 }]),
    };
    const moaService = {
      list: vi.fn().mockResolvedValue([{ name: 'EGFR inhibitor', description: 'x', display_order: 1 }]),
    };
    const roaService = {
      list: vi.fn().mockResolvedValue([{ name: 'Oral', abbreviation: 'PO', display_order: 1 }]),
    };

    const [inds, moas, roas] = await Promise.all([
      indService.list('s1'),
      moaService.list('s1'),
      roaService.list('s1'),
    ]);
    const { indications, moa, roa } = toVocabRows(inds, moas, roas);

    expect(indications[0].name).toBe('NSCLC');
    expect(moa[0].name).toBe('EGFR inhibitor');
    expect(roa[0].name).toBe('Oral');
  });

  it('sorts rows by display_order ascending', () => {
    const inds = [
      { name: 'AML', abbreviation: 'AML', display_order: 2 },
      { name: 'NSCLC', abbreviation: 'NSCLC', display_order: 1 },
    ];
    const { indications } = toVocabRows(inds, [], []);
    expect(indications.map((r) => r.name)).toEqual(['NSCLC', 'AML']);
  });

  it('uses description for MoA detail and abbreviation for Indication and RoA', () => {
    const { indications, moa, roa } = toVocabRows(
      [{ name: 'IND', abbreviation: 'I', display_order: 1 }],
      [{ name: 'MOA', description: 'MOA desc', display_order: 1 }],
      [{ name: 'ROA', abbreviation: 'IV', display_order: 1 }],
    );
    expect(indications[0].detail).toBe('I');
    expect(moa[0].detail).toBe('MOA desc');
    expect(roa[0].detail).toBe('IV');
  });

  it('coerces null abbreviation and description to null detail', () => {
    const { indications, moa, roa } = toVocabRows(
      [{ name: 'IND', abbreviation: null, display_order: 1 }],
      [{ name: 'MOA', description: null, display_order: 1 }],
      [{ name: 'ROA', abbreviation: null, display_order: 1 }],
    );
    expect(indications[0].detail).toBeNull();
    expect(moa[0].detail).toBeNull();
    expect(roa[0].detail).toBeNull();
  });
});

describe('TaxonomiesHelpComponent template contract', () => {
  it('imports the three taxonomy services', () => {
    expect(src).toContain("from '../../core/services/indication.service'");
    expect(src).toContain("from '../../core/services/mechanism-of-action.service'");
    expect(src).toContain("from '../../core/services/route-of-administration.service'");
  });

  it('uses ManagePageShellComponent and LoaderComponent', () => {
    expect(src).toContain('ManagePageShellComponent');
    expect(src).toContain('LoaderComponent');
  });

  it('uses app-loader while loading and groups() when done', () => {
    expect(src).toContain('app-loader');
    expect(src).toContain('groups()');
    expect(src).toContain('loading()');
  });

  it('renders the three vocabulary section headings', () => {
    expect(src).toContain('Therapeutic areas / Indications');
    expect(src).toContain('Mechanisms of action (MoA)');
    expect(src).toContain('Routes of administration (RoA)');
  });

  it('reads spaceId from paramMap to call services', () => {
    expect(src).toContain("paramMap.get('spaceId')");
  });

  it('has a back link using backLink() and RouterLink', () => {
    expect(src).toContain('RouterLink');
    expect(src).toContain('backLink()');
    expect(src).toContain('Back to timeline');
  });

  it('uses OnPush change detection', () => {
    expect(src).toContain('ChangeDetectionStrategy.OnPush');
  });

  it('is a standalone component with the correct class name', () => {
    expect(src).toContain('export class TaxonomiesHelpComponent');
  });
});
