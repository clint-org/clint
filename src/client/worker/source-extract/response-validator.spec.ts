import { describe, it, expect } from 'vitest';
import { validateExtraction } from './response-validator';
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
const MARKER_ID = '00000000-0000-4000-8000-000000000005';
const EVENT_ID = '00000000-0000-4000-8000-000000000006';
const MISSING_ID = '00000000-0000-4000-8000-000000000099'; // never in any inventory

function baseInventory(overrides: Partial<InventorySnapshot> = {}): InventorySnapshot {
  return {
    companies: [{ id: COMPANY_ID, name: 'Test Co' }],
    assets: [{ id: ASSET_ID, name: 'Test Asset', company_id: COMPANY_ID }],
    trials: [{ id: TRIAL_ID, name: 'Test Trial', asset_id: ASSET_ID }],
    indications: [],
    marker_types: [{ id: '60000000-0000-0000-0000-000000000001', name: 'Topline Data' }],
    event_categories: [{ id: '70000000-0000-0000-0000-000000000001', name: 'Clinical' }],
    mechanisms_of_action: [],
    routes_of_administration: [],
    hash: 'test-hash',
    ...overrides,
  };
}

/**
 * Minimal valid raw JSON with one company (existing), one asset (existing),
 * and one or more trials. Supply extra.trials to override the default
 * single existing trial. Supply extra.markers / extra.events to populate
 * those arrays.
 */
function makeRaw(extra: {
  trials?: unknown[];
  markers?: unknown[];
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
    markers: extra.markers ?? [],
    events: extra.events ?? [],
  });
}

function existingMarker(id: string, trialRef = 0): unknown {
  return {
    match: { kind: 'existing', id },
    marker_type: 'Topline Data',
    title: 'Readout',
    event_date: '2024-06-01',
    trial_refs: [trialRef],
    evidence: 'ev',
  };
}

function existingEvent(
  id: string,
  anchorLevel: 'space' | 'company' | 'asset' | 'trial' = 'trial',
  anchorRef: number | null = 0,
): unknown {
  return {
    match: { kind: 'existing', id },
    category: 'Clinical',
    title: 'Phase 3 data readout',
    event_date: '2024-06-01',
    anchor: { level: anchorLevel, ref: anchorRef },
    evidence: 'ev',
  };
}

// ---------------------------------------------------------------------------
// Marker match validation
// ---------------------------------------------------------------------------

describe('validateExtraction: marker match validation', () => {
  it('demotes marker match when existing id is not in inventory', () => {
    const raw = makeRaw({ markers: [existingMarker(MISSING_ID)] });
    const inv = baseInventory({
      markers: [
        {
          id: MARKER_ID,
          trial_id: TRIAL_ID,
          marker_type: 'Topline Data',
          title: 'Readout',
          event_date: '2024-06-01',
        },
      ],
    });

    const out = validateExtraction(raw, inv, 'source text', SKIP);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.markers[0].match).toEqual({ kind: 'new' });
    expect(out.warnings.some((w) => w.includes(MISSING_ID))).toBe(true);
  });

  it('preserves a valid marker match', () => {
    const raw = makeRaw({ markers: [existingMarker(MARKER_ID)] });
    const inv = baseInventory({
      markers: [
        {
          id: MARKER_ID,
          trial_id: TRIAL_ID,
          marker_type: 'Topline Data',
          title: 'Readout',
          event_date: '2024-06-01',
        },
      ],
    });

    const out = validateExtraction(raw, inv, 'source text', SKIP);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.markers[0].match).toEqual({ kind: 'existing', id: MARKER_ID });
  });

  it('demotes marker match when inventory record belongs to a different trial', () => {
    // Proposal places the marker on trials[1] (TRIAL_ID_B),
    // but the inventory record says the marker belongs to TRIAL_ID.
    const raw = makeRaw({
      trials: [
        {
          match: { kind: 'existing', id: TRIAL_ID },
          name: 'Trial A',
          sponsor_ref: 0,
          asset_refs: [0],
          evidence: 'ev',
        },
        {
          match: { kind: 'existing', id: TRIAL_ID_B },
          name: 'Trial B',
          sponsor_ref: 0,
          asset_refs: [0],
          evidence: 'ev',
        },
      ],
      markers: [existingMarker(MARKER_ID, 1 /* trial_refs[0] = index 1 = TRIAL_ID_B */)],
    });
    const inv = baseInventory({
      trials: [
        { id: TRIAL_ID, name: 'Trial A', asset_id: ASSET_ID },
        { id: TRIAL_ID_B, name: 'Trial B', asset_id: ASSET_ID },
      ],
      markers: [
        {
          id: MARKER_ID,
          trial_id: TRIAL_ID, // belongs to TRIAL_ID, NOT TRIAL_ID_B
          marker_type: 'Topline Data',
          title: 'Readout',
          event_date: '2024-06-01',
        },
      ],
    });

    const out = validateExtraction(raw, inv, 'source text', SKIP);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.markers[0].match).toEqual({ kind: 'new' });
  });

  it('demotes marker match when the resolved trial is new', () => {
    // A new trial cannot have existing markers.
    const raw = makeRaw({
      trials: [
        {
          match: { kind: 'new', name: 'Brand New Trial' },
          name: 'Brand New Trial',
          sponsor_ref: 0,
          asset_refs: [0],
          evidence: 'ev',
        },
      ],
      markers: [existingMarker(MARKER_ID)],
    });
    const inv = baseInventory({
      markers: [
        {
          id: MARKER_ID,
          trial_id: TRIAL_ID,
          marker_type: 'Topline Data',
          title: 'Readout',
          event_date: '2024-06-01',
        },
      ],
    });

    const out = validateExtraction(raw, inv, 'source text', SKIP);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.markers[0].match).toEqual({ kind: 'new' });
  });

  it('keeps first claim and demotes duplicate claim of same existing id', () => {
    const raw = makeRaw({
      markers: [existingMarker(MARKER_ID), existingMarker(MARKER_ID)],
    });
    const inv = baseInventory({
      markers: [
        {
          id: MARKER_ID,
          trial_id: TRIAL_ID,
          marker_type: 'Topline Data',
          title: 'Readout',
          event_date: '2024-06-01',
        },
      ],
    });

    const out = validateExtraction(raw, inv, 'source text', SKIP);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.markers[0].match).toEqual({ kind: 'existing', id: MARKER_ID });
    expect(out.result.markers[1].match).toEqual({ kind: 'new' });
  });
});

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
});
