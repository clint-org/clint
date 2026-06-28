/**
 * Events model QA fixture (Task 0.1).
 *
 * Verifies that seed_events_model_qa(p_space_id) populates the exact
 * acceptance-matrix scenario set used as the backtest backbone for every
 * Phase A and Phase C assertion.
 *
 * Step 1 (TDD RED): this spec exists before the migration; the first
 * describe block will fail with PGRST202 because the RPC is absent.
 * Step 4 (TDD GREEN): after the migration the spec passes end to end.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectOk } from '../harness/as';

let p: Personas;
beforeAll(async () => {
  p = await buildPersonas();
}, 90_000);

describe('events model QA fixture', () => {
  const admin = adminClient();

  it('seed_events_model_qa populates the full acceptance-matrix scenario set', async () => {
    const r = await as(p, 'space_owner').rpc('seed_events_model_qa', {
      p_space_id: p.org.spaceId,
    });
    expectOk(r);

    // --- events by anchor_type (EXACT counts + exact type sets) ---
    // System event_type UUIDs (stable). The fixture is the backtest backbone:
    // a dropped or swapped event type must fail loudly, so assert exact sets,
    // not >=1 floors.
    const ET_TRIAL_START = 'a0000000-0000-0000-0000-000000000011';
    const ET_PCD = 'a0000000-0000-0000-0000-000000000008';
    const ET_TOPLINE = 'a0000000-0000-0000-0000-000000000013';
    const ET_APPROVAL = 'a0000000-0000-0000-0000-000000000035';
    const ET_REGULATORY = 'a0000000-0000-0000-0000-000000000032';
    const ET_DISTRIBUTION = 'a0000000-0000-0000-0000-000000000040';
    const ET_LOE = 'a0000000-0000-0000-0000-000000000020';

    const { data: events, error: evErr } = await admin
      .from('events')
      .select('id, anchor_type, event_type_id, visibility, significance, projection, is_projected')
      .eq('space_id', p.org.spaceId);
    expect(evErr).toBeNull();
    expect(events).not.toBeNull();

    const trialEvents = events!.filter((e) => e.anchor_type === 'trial');
    const assetEvents = events!.filter((e) => e.anchor_type === 'asset');
    const companyEvents = events!.filter((e) => e.anchor_type === 'company');

    // trial: exactly 4 clinical events, exact type set
    expect(trialEvents).toHaveLength(4);
    expect(new Set(trialEvents.map((e) => e.event_type_id))).toEqual(
      new Set([ET_TRIAL_START, ET_PCD, ET_TOPLINE, ET_APPROVAL]),
    );

    // asset: exactly 4 events (Approval, Distribution, projected Regulatory,
    // hidden LOE), exact type set
    expect(assetEvents).toHaveLength(4);
    expect(new Set(assetEvents.map((e) => e.event_type_id))).toEqual(
      new Set([ET_APPROVAL, ET_DISTRIBUTION, ET_REGULATORY, ET_LOE]),
    );

    // company: exactly 2 events (pinned Strategic, feed-only Leadership)
    expect(companyEvents).toHaveLength(2);

    // --- exactly one pinned event ---
    const pinned = events!.filter((e) => e.visibility === 'pinned');
    expect(pinned).toHaveLength(1);

    // --- exactly one hidden high-significance event ---
    const hidden = events!.filter((e) => e.visibility === 'hidden');
    expect(hidden).toHaveLength(1);
    expect(hidden[0].significance).toBe('high');

    // --- exactly one projected event ---
    const projected = events!.filter((e) => e.is_projected === true);
    expect(projected).toHaveLength(1);
    expect(projected[0].projection).toBe('primary');

    // --- brief with event-citation link ---
    const { data: anchors, error: anchorErr } = await admin
      .from('primary_intelligence_anchors')
      .select('id')
      .eq('space_id', p.org.spaceId);
    expect(anchorErr).toBeNull();
    expect(anchors).toHaveLength(1);

    const { data: piRows, error: piErr } = await admin
      .from('primary_intelligence')
      .select('id, state')
      .eq('anchor_id', anchors![0].id);
    expect(piErr).toBeNull();
    expect(piRows).not.toBeNull();
    expect(piRows!.length).toBeGreaterThanOrEqual(1);
    const publishedBrief = piRows!.find((r) => r.state === 'published');
    expect(publishedBrief).toBeDefined();

    const { data: piLinks, error: linkErr } = await admin
      .from('primary_intelligence_links')
      .select('entity_type, entity_id')
      .eq('primary_intelligence_id', publishedBrief!.id);
    expect(linkErr).toBeNull();
    const eventLinks = (piLinks ?? []).filter((l) => l.entity_type === 'event');
    expect(eventLinks).toHaveLength(1);

    // citation entity_id must resolve to a real event in the space
    const citedEventId = eventLinks[0].entity_id;
    const { data: citedEvent } = await admin
      .from('events')
      .select('id')
      .eq('id', citedEventId)
      .eq('space_id', p.org.spaceId)
      .single();
    expect(citedEvent).not.toBeNull();

    // --- 2 companies and 2 assets ---
    const { data: companies } = await admin
      .from('companies')
      .select('id')
      .eq('space_id', p.org.spaceId);
    expect(companies).toHaveLength(2);

    const { data: assets } = await admin
      .from('assets')
      .select('id')
      .eq('space_id', p.org.spaceId);
    expect(assets).toHaveLength(2);
  });

  it('seed_events_model_qa is idempotent (second call does not duplicate rows)', async () => {
    const { data: before } = await admin
      .from('events')
      .select('id')
      .eq('space_id', p.org.spaceId);
    const countBefore = before!.length;
    expect(countBefore).toBeGreaterThan(0);

    const r = await as(p, 'space_owner').rpc('seed_events_model_qa', {
      p_space_id: p.org.spaceId,
    });
    expectOk(r);

    const { data: after } = await admin
      .from('events')
      .select('id')
      .eq('space_id', p.org.spaceId);
    expect(after!.length).toBe(countBefore);
  });
});
