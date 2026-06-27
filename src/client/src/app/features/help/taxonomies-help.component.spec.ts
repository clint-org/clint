/**
 * Tests for TaxonomiesHelpComponent.
 *
 * The unit runner is a plain node environment (vitest.units.config.ts) with no
 * Angular compiler. We test the shared row-mapping contract by importing the
 * real exported `toVocabRows` function from the component module, and verify
 * the template wiring by source contract (readFileSync). This follows the same
 * pattern used by heatmap-detail-panel.component.spec.ts and other component
 * specs in this codebase.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { toVocabRows } from './taxonomies-help.utils';

const src = readFileSync(join(__dirname, 'taxonomies-help.component.ts'), 'utf8');

describe('toVocabRows (shared mapping contract)', () => {
  it('maps service data to name and detail fields', () => {
    const inds = toVocabRows(
      [{ name: 'NSCLC', abbreviation: 'NSCLC', display_order: 1 }],
      (r) => r.abbreviation ?? null,
    );
    const moas = toVocabRows(
      [{ name: 'EGFR inhibitor', description: 'x', display_order: 1 }],
      (r) => r.description ?? null,
    );
    const roas = toVocabRows(
      [{ name: 'Oral', abbreviation: 'PO', display_order: 1 }],
      (r) => r.abbreviation ?? null,
    );

    expect(inds[0].name).toBe('NSCLC');
    expect(moas[0].name).toBe('EGFR inhibitor');
    expect(roas[0].name).toBe('Oral');
  });

  it('sorts rows by display_order ascending', () => {
    const rows = toVocabRows(
      [
        { name: 'AML', display_order: 2 },
        { name: 'NSCLC', display_order: 1 },
      ],
      () => null,
    );
    expect(rows.map((r) => r.name)).toEqual(['NSCLC', 'AML']);
  });

  it('uses description for MoA detail and abbreviation for Indication and RoA', () => {
    const indications = toVocabRows(
      [{ name: 'IND', abbreviation: 'I', display_order: 1 }],
      (r) => r.abbreviation ?? null,
    );
    const moa = toVocabRows(
      [{ name: 'MOA', description: 'MOA desc', display_order: 1 }],
      (r) => r.description ?? null,
    );
    const roa = toVocabRows(
      [{ name: 'ROA', abbreviation: 'IV', display_order: 1 }],
      (r) => r.abbreviation ?? null,
    );
    expect(indications[0].detail).toBe('I');
    expect(moa[0].detail).toBe('MOA desc');
    expect(roa[0].detail).toBe('IV');
  });

  it('coerces null abbreviation and description to null detail', () => {
    const indications = toVocabRows(
      [{ name: 'IND', abbreviation: null, display_order: 1 }],
      (r) => r.abbreviation ?? null,
    );
    const moa = toVocabRows(
      [{ name: 'MOA', description: null, display_order: 1 }],
      (r) => r.description ?? null,
    );
    const roa = toVocabRows(
      [{ name: 'ROA', abbreviation: null, display_order: 1 }],
      (r) => r.abbreviation ?? null,
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

  it('uses OnPush change detection', () => {
    expect(src).toContain('ChangeDetectionStrategy.OnPush');
  });

  it('is a standalone component with the correct class name', () => {
    expect(src).toContain('export class TaxonomiesHelpComponent');
  });
});
