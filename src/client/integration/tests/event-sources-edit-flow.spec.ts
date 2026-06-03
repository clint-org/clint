/**
 * Event-sources edit flow against real Supabase.
 *
 * Locks in the user-facing contract for update_event_sources (migration
 * 20260528130000). The RPC replaces the analyst's two-step
 * DELETE-then-INSERT pattern in EventService.updateSources() with a single
 * insert-then-prune transaction. The migration's inline SQL smoke covers
 * the regression contract under a simulated future orphan-cleanup trigger;
 * this spec covers the happy path and auth model that the client depends on.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectCode, expectOk } from '../harness/as';

let p: Personas;
let admin: SupabaseClient;
let systemCategoryId: string;

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
}, 120_000);

afterAll(async () => {
  if (eventIds.length > 0) {
    await admin.from('events').delete().in('id', eventIds);
  }
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

async function seedSources(
  eventId: string,
  rows: { url: string; label: string | null }[]
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await admin
    .from('event_sources')
    .insert(rows.map((r) => ({ event_id: eventId, url: r.url, label: r.label })));
  if (error) throw new Error(`seedSources: ${error.message}`);
}

async function readSources(
  eventId: string
): Promise<{ url: string; label: string | null }[]> {
  const { data } = await admin
    .from('event_sources')
    .select('url, label')
    .eq('event_id', eventId)
    .order('url');
  return (data ?? []) as { url: string; label: string | null }[];
}

describe('update_event_sources RPC', () => {
  it('replaces the sole source with a new url + label', async () => {
    const eventId = await createEvent('sources-swap');
    await seedSources(eventId, [{ url: 'https://old.example', label: 'Old' }]);

    const r = await as(p, 'contributor').rpc('update_event_sources', {
      p_event_id: eventId,
      p_urls: ['https://new.example'],
      p_labels: ['New'],
    });
    expectOk(r);

    expect(await readSources(eventId)).toEqual([
      { url: 'https://new.example', label: 'New' },
    ]);
  });

  it('handles add/remove diffs and updates labels on the kept rows', async () => {
    const eventId = await createEvent('sources-diff');
    await seedSources(eventId, [
      { url: 'https://a.example', label: 'Original A' },
      { url: 'https://b.example', label: 'Original B' },
    ]);

    const r = await as(p, 'contributor').rpc('update_event_sources', {
      p_event_id: eventId,
      p_urls: ['https://b.example', 'https://c.example'],
      p_labels: ['Updated B', 'Fresh C'],
    });
    expectOk(r);

    expect(await readSources(eventId)).toEqual([
      { url: 'https://b.example', label: 'Updated B' },
      { url: 'https://c.example', label: 'Fresh C' },
    ]);
  });

  it('is idempotent when called with the same set', async () => {
    const eventId = await createEvent('sources-idemp');
    await seedSources(eventId, [{ url: 'https://a.example', label: 'A' }]);

    const r = await as(p, 'contributor').rpc('update_event_sources', {
      p_event_id: eventId,
      p_urls: ['https://a.example'],
      p_labels: ['A'],
    });
    expectOk(r);

    expect(await readSources(eventId)).toEqual([
      { url: 'https://a.example', label: 'A' },
    ]);
  });

  it('accepts empty arrays as clear-all and leaves the event intact', async () => {
    const eventId = await createEvent('sources-clear');
    await seedSources(eventId, [{ url: 'https://a.example', label: 'A' }]);

    const r = await as(p, 'contributor').rpc('update_event_sources', {
      p_event_id: eventId,
      p_urls: [],
      p_labels: [],
    });
    expectOk(r);

    expect(await readSources(eventId)).toEqual([]);

    const { data: ev } = await admin
      .from('events')
      .select('id')
      .eq('id', eventId)
      .maybeSingle();
    expect(ev?.id).toBe(eventId);
  });

  it('rejects mismatched url/label array lengths with 22023', async () => {
    const eventId = await createEvent('sources-mismatch');
    await seedSources(eventId, [{ url: 'https://a.example', label: 'A' }]);

    const r = await as(p, 'contributor').rpc('update_event_sources', {
      p_event_id: eventId,
      p_urls: ['https://b.example', 'https://c.example'],
      p_labels: ['Only one'],
    });
    expectCode(r, '22023');

    // sources untouched
    expect(await readSources(eventId)).toEqual([
      { url: 'https://a.example', label: 'A' },
    ]);
  });

  it('rejects a viewer with 42501 and leaves the sources intact', async () => {
    const eventId = await createEvent('sources-viewer');
    await seedSources(eventId, [{ url: 'https://a.example', label: 'A' }]);

    const r = await as(p, 'reader').rpc('update_event_sources', {
      p_event_id: eventId,
      p_urls: ['https://b.example'],
      p_labels: ['B'],
    });
    expectCode(r, '42501');

    expect(await readSources(eventId)).toEqual([
      { url: 'https://a.example', label: 'A' },
    ]);
  });
});
