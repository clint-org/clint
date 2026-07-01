import { describe, it, expect } from 'vitest';
import { validateExtraction } from './response-validator';
import { ExtractionResultSchema } from './types';
import type { InventorySnapshot } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SKIP = { skipNameGrounding: true } as const;

// UUID v4 constants for test fixtures (third group starts with 4, fourth with 8/9/a/b)
const COMPANY_ID = '00000000-0000-4000-8000-000000000001';
const ASSET_ID = '00000000-0000-4000-8000-000000000002';
const TRIAL_ID = '00000000-0000-4000-8000-000000000003';
const TRIAL_ID_B = '00000000-0000-4000-8000-000000000004';
const EVENT_ID = '00000000-0000-4000-8000-000000000006';
const MISSING_ID = '00000000-0000-4000-8000-000000000099'; // never in any inventory

function baseInventory(overrides: Partial<InventorySnapshot> = {}): InventorySnapshot {
  return {
    companies: [{ id: COMPANY_ID, name: 'Test Co' }],
    assets: [{ id: ASSET_ID, name: 'Test Asset', company_id: COMPANY_ID }],
    trials: [{ id: TRIAL_ID, name: 'Test Trial', asset_id: ASSET_ID }],
    indications: [],
    event_types: [{ id: '60000000-0000-0000-0000-000000000001', name: 'Topline Data' }],
    event_type_categories: [{ id: '70000000-0000-0000-0000-000000000001', name: 'Clinical' }],
    mechanisms_of_action: [],
    routes_of_administration: [],
    hash: 'test-hash',
    ...overrides,
  };
}

/**
 * Minimal valid raw JSON with one company (existing), one asset (existing),
 * and one or more trials. Supply extra.trials to override the default
 * single existing trial. Supply extra.events to populate the events array.
 */
function makeRaw(extra: {
  trials?: unknown[];
  events?: unknown[];
} = {}): string {
  return JSON.stringify({
    source_summary: 'Test summary',
    companies: [{ match: { kind: 'existing', id: COMPANY_ID }, evidence: 'ev' }],
    assets: [
      {
        match: { kind: 'existing', id: ASSET_ID },
        name: 'Test Asset',
        company_ref: 0,
        evidence: 'ev',
      },
    ],
    trials: extra.trials ?? [
      {
        match: { kind: 'existing', id: TRIAL_ID },
        name: 'Test Trial',
        sponsor_ref: 0,
        asset_refs: [0],
        evidence: 'ev',
      },
    ],
    events: extra.events ?? [],
  });
}

function existingEvent(
  id: string,
  anchorLevel: 'space' | 'company' | 'asset' | 'trial' = 'trial',
  anchorRef: number | null = 0,
): unknown {
  return {
    match: { kind: 'existing', id },
    event_type: 'Topline Data',
    title: 'Phase 3 data readout',
    event_date: '2024-06-01',
    anchor: { level: anchorLevel, ref: anchorRef },
    evidence: 'ev',
  };
}

// ---------------------------------------------------------------------------
// Event match validation
// ---------------------------------------------------------------------------

describe('validateExtraction: event match validation', () => {
  it('demotes event match when existing id is not in inventory', () => {
    const raw = makeRaw({ events: [existingEvent(MISSING_ID)] });
    const inv = baseInventory({
      events: [
        {
          id: EVENT_ID,
          anchor: { level: 'trial' as const, id: TRIAL_ID },
          category: 'Clinical',
          title: 'Phase 3 data readout',
          event_date: '2024-06-01',
        },
      ],
    });

    const out = validateExtraction(raw, inv, 'source text', SKIP);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.events[0].match).toEqual({ kind: 'new' });
    expect(out.warnings.some((w) => w.includes(MISSING_ID))).toBe(true);
  });

  it('preserves a valid event match', () => {
    const raw = makeRaw({ events: [existingEvent(EVENT_ID)] });
    const inv = baseInventory({
      events: [
        {
          id: EVENT_ID,
          anchor: { level: 'trial' as const, id: TRIAL_ID },
          category: 'Clinical',
          title: 'Phase 3 data readout',
          event_date: '2024-06-01',
        },
      ],
    });

    const out = validateExtraction(raw, inv, 'source text', SKIP);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.events[0].match).toEqual({ kind: 'existing', id: EVENT_ID });
  });

  it('demotes event match when inventory record belongs to a different anchor', () => {
    // Proposal anchors this event to trials[0] (TRIAL_ID),
    // but the inventory record says it belongs to TRIAL_ID_B.
    const raw = makeRaw({ events: [existingEvent(EVENT_ID, 'trial', 0)] });
    const inv = baseInventory({
      events: [
        {
          id: EVENT_ID,
          anchor: { level: 'trial' as const, id: TRIAL_ID_B },
          category: 'Clinical',
          title: 'Phase 3 data readout',
          event_date: '2024-06-01',
        },
      ],
    });

    const out = validateExtraction(raw, inv, 'source text', SKIP);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.events[0].match).toEqual({ kind: 'new' });
  });

  it('demotes event match when the resolved anchor entity is new', () => {
    // The event is anchored to trials[0], which is a new trial.
    // A new trial cannot have existing events.
    const raw = makeRaw({
      trials: [
        {
          match: { kind: 'new', name: 'New Trial' },
          name: 'New Trial',
          sponsor_ref: 0,
          asset_refs: [0],
          evidence: 'ev',
        },
      ],
      events: [existingEvent(EVENT_ID, 'trial', 0)],
    });
    const inv = baseInventory({
      events: [
        {
          id: EVENT_ID,
          anchor: { level: 'trial' as const, id: TRIAL_ID },
          category: 'Clinical',
          title: 'Phase 3 data readout',
          event_date: '2024-06-01',
        },
      ],
    });

    const out = validateExtraction(raw, inv, 'source text', SKIP);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.events[0].match).toEqual({ kind: 'new' });
  });

  it('keeps first claim and demotes duplicate claim of same existing event id', () => {
    const raw = makeRaw({
      events: [existingEvent(EVENT_ID), existingEvent(EVENT_ID)],
    });
    const inv = baseInventory({
      events: [
        {
          id: EVENT_ID,
          anchor: { level: 'trial' as const, id: TRIAL_ID },
          category: 'Clinical',
          title: 'Phase 3 data readout',
          event_date: '2024-06-01',
        },
      ],
    });

    const out = validateExtraction(raw, inv, 'source text', SKIP);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.events[0].match).toEqual({ kind: 'existing', id: EVENT_ID });
    expect(out.result.events[1].match).toEqual({ kind: 'new' });
  });

  it('demotes an event existing-match whose id is absent from inventory', () => {
    const res = validateExtraction(
      JSON.stringify({
        source_summary: 's',
        companies: [], assets: [], trials: [],
        events: [{
          match: { kind: 'existing', id: '00000000-0000-4000-8000-0000000000ff' },
          event_type: 'Regulatory Filing', title: 'BLA', event_date: '2026-08-01',
          anchor: { level: 'space', ref: null }, evidence: 'e',
        }],
      }),
      { companies: [], assets: [], trials: [], indications: [],
        event_types: [], event_type_categories: [],
        mechanisms_of_action: [], routes_of_administration: [],
        events: [], hash: 'h' },
      'BLA filing accepted',
      { skipNameGrounding: true },
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.result.events[0].match as { kind: string }).kind).toBe('new');
  });
});

// ---------------------------------------------------------------------------
// Unified EventSchema
// ---------------------------------------------------------------------------

describe('unified EventSchema', () => {
  it('parses an event carrying event_type + significance + anchor', () => {
    const parsed = ExtractionResultSchema.parse({
      source_summary: 's',
      events: [
        {
          match: { kind: 'new' },
          event_type: 'Topline Data',
          title: 'Phase 3 readout',
          event_date: '2026-07-01',
          significance: 'high',
          anchor: { level: 'trial', ref: 0 },
          evidence: 'q',
        },
      ],
    });
    expect(parsed.events[0].event_type).toBe('Topline Data');
    expect(parsed.events[0].significance).toBe('high');
    expect(parsed.events[0].projection).toBe('company'); // default
    expect(parsed.events[0].tags).toEqual([]); // default
    expect('markers' in parsed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Trial NCT grounding (#184): a source-grounded nct_id keeps a trial whose
// display name is not verbatim in the source.
// ---------------------------------------------------------------------------

describe('validateExtraction: trial NCT grounding', () => {
  const newTrial = (over: Record<string, unknown> = {}): unknown => ({
    match: { kind: 'new', name: 'Survodutide MASH P2' },
    name: 'Survodutide MASH P2',
    sponsor_ref: 0,
    asset_refs: [0],
    evidence: 'ev',
    ...over,
  });
  // Source states the NCT but not the trial's display name.
  const SRC = 'The trial, registered on ClinicalTrials.gov as NCT04771273, met its endpoint.';

  it('keeps a new trial whose name is not verbatim but whose nct_id is in the source', () => {
    const out = validateExtraction(makeRaw({ trials: [newTrial({ nct_id: 'NCT04771273' })] }), baseInventory(), SRC);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.trials).toHaveLength(1);
    expect(out.result.trials[0].nct_id).toBe('NCT04771273');
    expect(out.dropped.some((d) => d.type === 'trial')).toBe(false);
  });

  it('still drops a new trial with neither a grounded name nor a grounded nct_id', () => {
    const out = validateExtraction(makeRaw({ trials: [newTrial({ nct_id: null })] }), baseInventory(), SRC);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.trials).toHaveLength(0);
    expect(out.dropped.some((d) => d.type === 'trial' && d.reason === 'name not found in source text')).toBe(true);
  });

  it('does not ground on an nct_id that is absent from the source (model hallucination)', () => {
    const out = validateExtraction(makeRaw({ trials: [newTrial({ nct_id: 'NCT09999999' })] }), baseInventory(), SRC);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.trials).toHaveLength(0);
    expect(out.dropped.some((d) => d.type === 'trial')).toBe(true);
  });
});
