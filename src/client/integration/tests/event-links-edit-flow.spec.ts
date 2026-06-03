/**
 * Event-links edit flow against real Supabase.
 *
 * Locks in the user-facing contract for update_event_links (migration
 * 20260528130100). The RPC manages a source event's outgoing links only:
 * back-links from other events to this one are not touched. The migration's
 * inline SQL smoke covers the regression contract under a simulated future
 * orphan-cleanup trigger; this spec covers happy path, back-link
 * preservation, cross-space rejection, self-link rejection, and the
 * viewer-role auth contract.
 *
 * Pre-fix history: EventService.updateLinks() was dead code (the edit form
 * never called it). With this RPC + event-form wire-up, analyst changes to
 * the linked-events field actually persist; this spec is what regression-
 * tests that bug fix from the data side.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectCode, expectOk } from '../harness/as';

let p: Personas;
let admin: SupabaseClient;
let systemCategoryId: string;

// Auxiliary tenant+space the contributor persona cannot read. Used to prove
// cross-space link targets are rejected with 22023.
let alienSpaceId: string;
let alienTenantId: string;
let alienEventId: string;

const eventIds: string[] = [];

beforeAll(async () => {
  p = await buildPersonas();
  admin = adminClient();

  const { data: cat } = await admin
    .from('event_categories')
    .select('id')
    .is('space_id', null)
    .limit(1)
    .single();
  systemCategoryId = cat!.id as string;

  // Alien tenant + space, no personas memberships. The contributor persona
  // has no space_members row here, so has_space_access() returns false.
  const slug = `uel-alien-${Date.now().toString(36)}`;
  const { data: tenant, error: tErr } = await admin
    .from('tenants')
    .insert({ name: `uel-alien-${slug}`, slug })
    .select('id')
    .single();
  if (tErr) throw new Error(`alien tenant: ${tErr.message}`);
  alienTenantId = tenant!.id as string;

  const { data: space, error: sErr } = await admin
    .from('spaces')
    .insert({
      tenant_id: alienTenantId,
      name: 'uel-alien-space',
      created_by: p.ids.contributor,
    })
    .select('id')
    .single();
  if (sErr) throw new Error(`alien space: ${sErr.message}`);
  alienSpaceId = space!.id as string;

  const { data: ev } = await admin
    .from('events')
    .insert({
      space_id: alienSpaceId,
      category_id: systemCategoryId,
      title: 'uel-alien-event',
      event_date: '2026-06-01',
      created_by: p.ids.contributor,
    })
    .select('id')
    .single();
  alienEventId = ev!.id as string;
}, 120_000);

afterAll(async () => {
  if (eventIds.length > 0) {
    await admin.from('events').delete().in('id', eventIds);
  }
  if (alienEventId) await admin.from('events').delete().eq('id', alienEventId);
  if (alienSpaceId) await admin.from('spaces').delete().eq('id', alienSpaceId);
  if (alienTenantId) await admin.from('tenants').delete().eq('id', alienTenantId);
});

async function createEvent(title: string): Promise<string> {
  const { data, error } = await admin
    .from('events')
    .insert({
      space_id: p.org.spaceId,
      category_id: systemCategoryId,
      title,
      event_date: '2026-06-01',
      created_by: p.ids.contributor,
    })
    .select('id')
    .single();
  if (error) throw new Error(`createEvent: ${error.message}`);
  const id = data!.id as string;
  eventIds.push(id);
  return id;
}

async function seedLink(sourceId: string, targetId: string): Promise<void> {
  const { error } = await admin
    .from('event_links')
    .insert({ source_event_id: sourceId, target_event_id: targetId });
  if (error) throw new Error(`seedLink: ${error.message}`);
}

async function outgoingTargets(sourceId: string): Promise<string[]> {
  const { data } = await admin
    .from('event_links')
    .select('target_event_id')
    .eq('source_event_id', sourceId);
  return ((data ?? []) as { target_event_id: string }[]).map((r) => r.target_event_id).sort();
}

async function linkExists(sourceId: string, targetId: string): Promise<boolean> {
  const { data } = await admin
    .from('event_links')
    .select('source_event_id')
    .eq('source_event_id', sourceId)
    .eq('target_event_id', targetId)
    .maybeSingle();
  return data !== null;
}

describe('update_event_links RPC', () => {
  it('replaces the sole outgoing link with a new target', async () => {
    const src = await createEvent('links-swap-src');
    const tgtA = await createEvent('links-swap-tgt-a');
    const tgtB = await createEvent('links-swap-tgt-b');
    await seedLink(src, tgtA);

    const r = await as(p, 'contributor').rpc('update_event_links', {
      p_event_id: src,
      p_linked_event_ids: [tgtB],
    });
    expectOk(r);

    expect(await outgoingTargets(src)).toEqual([tgtB].sort());
  });

  it('handles add/remove diffs', async () => {
    const src = await createEvent('links-diff-src');
    const tgtA = await createEvent('links-diff-tgt-a');
    const tgtB = await createEvent('links-diff-tgt-b');
    const tgtC = await createEvent('links-diff-tgt-c');
    await seedLink(src, tgtA);
    await seedLink(src, tgtB);

    const r = await as(p, 'contributor').rpc('update_event_links', {
      p_event_id: src,
      p_linked_event_ids: [tgtB, tgtC],
    });
    expectOk(r);

    expect(await outgoingTargets(src)).toEqual([tgtB, tgtC].sort());
  });

  it('does not touch back-links from other events', async () => {
    const src = await createEvent('links-back-src');
    const tgtA = await createEvent('links-back-tgt-a');
    const otherD = await createEvent('links-back-other-d');
    await seedLink(src, tgtA);
    await seedLink(otherD, src); // back-link D -> src

    const r = await as(p, 'contributor').rpc('update_event_links', {
      p_event_id: src,
      p_linked_event_ids: [],
    });
    expectOk(r);

    // outgoing cleared
    expect(await outgoingTargets(src)).toEqual([]);
    // back-link preserved
    expect(await linkExists(otherD, src)).toBe(true);
  });

  it('accepts empty array as clear-all and leaves the event intact', async () => {
    const src = await createEvent('links-clear-src');
    const tgtA = await createEvent('links-clear-tgt-a');
    await seedLink(src, tgtA);

    const r = await as(p, 'contributor').rpc('update_event_links', {
      p_event_id: src,
      p_linked_event_ids: [],
    });
    expectOk(r);

    expect(await outgoingTargets(src)).toEqual([]);
    const { data: ev } = await admin.from('events').select('id').eq('id', src).maybeSingle();
    expect(ev?.id).toBe(src);
  });

  it('rejects a self-link with 22023', async () => {
    const src = await createEvent('links-self');

    const r = await as(p, 'contributor').rpc('update_event_links', {
      p_event_id: src,
      p_linked_event_ids: [src],
    });
    expectCode(r, '22023');
  });

  it('rejects a target in a space the caller cannot read with 22023', async () => {
    const src = await createEvent('links-cross-space-src');

    const r = await as(p, 'contributor').rpc('update_event_links', {
      p_event_id: src,
      p_linked_event_ids: [alienEventId],
    });
    expectCode(r, '22023');

    // src outgoing unchanged
    expect(await outgoingTargets(src)).toEqual([]);
  });

  it('rejects a viewer with 42501 and leaves links intact', async () => {
    const src = await createEvent('links-viewer-src');
    const tgtA = await createEvent('links-viewer-tgt-a');
    const tgtB = await createEvent('links-viewer-tgt-b');
    await seedLink(src, tgtA);

    const r = await as(p, 'reader').rpc('update_event_links', {
      p_event_id: src,
      p_linked_event_ids: [tgtB],
    });
    expectCode(r, '42501');

    expect(await outgoingTargets(src)).toEqual([tgtA].sort());
  });
});
