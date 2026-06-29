/**
 * Task S1b backtest: event_sources WRITE paths + RLS firewall.
 *
 * Proves the two write RPCs the unified event model uses for sources:
 *   - create_event(p_sources jsonb)   -> atomic inline insert of event_sources
 *   - update_event_sources(uuid,text[],text[]) -> deterministic replace-all
 *
 * and the event_sources RLS firewall (mirrors how A9 proved events):
 *   - a VIEWER cannot write event_sources (42501 via the write path; direct
 *     insert denied by RLS).
 *   - a member of a SIBLING space gets zero rows for an event that lives in
 *     another space (sibling-no-leak); an owner/editor of the owning space can.
 *
 * Run in isolation (see task brief): the QA seed RPCs are not repointed until
 * C5, so only this spec is run here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectCode, expectOk } from '../harness/as';
import { SupabaseClient } from '@supabase/supabase-js';

let p: Personas;
let siblingSpaceId: string;
const admin = adminClient();

// System event_type UUID (stable; seeded by the event_types migration).
const ET_STRATEGIC = 'a0000000-0000-0000-0000-000000000070';

interface SourceRow {
  url: string;
  label: string | null;
  sort_order: number;
}

/** Create a space-anchored event in the personas space as the given persona. */
async function createEvent(
  client: SupabaseClient,
  opts: { title: string; sources?: unknown },
): Promise<{ data: string | null; error: { code?: string; message?: string } | null }> {
  return client.rpc('create_event', {
    p_space_id: p.org.spaceId,
    p_event_type_id: ET_STRATEGIC,
    p_title: opts.title,
    p_event_date: '2026-01-15',
    p_anchor_type: 'space',
    p_sources: opts.sources ?? null,
  });
}

/** Read event_sources for an event via the service role (RLS bypassed),
 *  ordered the way the index intends (sort_order, created_at). */
async function readSources(eventId: string): Promise<SourceRow[]> {
  const { data, error } = await admin
    .from('event_sources')
    .select('url, label, sort_order')
    .eq('event_id', eventId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(`readSources failed: ${error.message}`);
  return (data ?? []) as SourceRow[];
}

beforeAll(async () => {
  p = await buildPersonas();

  // Create a sibling space under the same tenant and make `no_memberships`
  // its owner. This gives us a true cross-space firewall subject: a real space
  // member who nonetheless has no access to the personas space's event_sources.
  const { data: space, error: spaceErr } = await admin
    .from('spaces')
    .insert({
      tenant_id: p.org.tenantId,
      name: 'S1b Sibling Space',
      created_by: p.ids.no_memberships,
    })
    .select()
    .single();
  if (spaceErr) throw new Error(`sibling space insert: ${spaceErr.message}`);
  siblingSpaceId = space.id as string;

  const { error: memberErr } = await admin
    .from('space_members')
    .insert({ space_id: siblingSpaceId, user_id: p.ids.no_memberships, role: 'owner' });
  if (memberErr) throw new Error(`sibling space_members insert: ${memberErr.message}`);
}, 120_000);

afterAll(async () => {
  // Remove the sibling space (cascades its membership). The personas wipe on the
  // next run also handles created_by, but leave the DB tidy.
  if (siblingSpaceId) await admin.from('spaces').delete().eq('id', siblingSpaceId);
});

describe('S1b: create_event(p_sources) atomic source writes', () => {
  it('create_event with 2 sources inserts 2 event_sources rows in array order', async () => {
    const res = await createEvent(as(p, 'space_owner'), {
      title: 'S1b two sources',
      sources: [
        { url: 'https://a.test', label: 'Alpha' },
        { url: 'https://b.test', label: 'Bravo' },
      ],
    });
    const eventId = expectOk(res);
    expect(typeof eventId).toBe('string');

    const rows = await readSources(eventId!);
    expect(rows.length).toBe(2);
    // sort_order = array ordinal (1-based) -> deterministic order.
    expect(rows[0]).toMatchObject({ url: 'https://a.test', label: 'Alpha', sort_order: 1 });
    expect(rows[1]).toMatchObject({ url: 'https://b.test', label: 'Bravo', sort_order: 2 });
  });

  it('create_event with p_sources null inserts zero event_sources rows', async () => {
    const res = await createEvent(as(p, 'space_owner'), { title: 'S1b no sources' });
    const eventId = expectOk(res);
    const rows = await readSources(eventId!);
    expect(rows.length).toBe(0);
  });

  it('create_event skips empty-string urls in p_sources', async () => {
    const res = await createEvent(as(p, 'space_owner'), {
      title: 'S1b empty skipped',
      sources: [
        { url: 'https://keep.test', label: 'Keep' },
        { url: '', label: 'Dropped empty' },
      ],
    });
    const eventId = expectOk(res);
    const rows = await readSources(eventId!);
    expect(rows.length).toBe(1);
    expect(rows[0].url).toBe('https://keep.test');
  });
});

describe('S1b: update_event_sources deterministic replace-all', () => {
  it('replaces existing sources (delete old, insert new) with index-based order', async () => {
    const created = await createEvent(as(p, 'space_owner'), {
      title: 'S1b update target',
      sources: [
        { url: 'https://old1.test', label: 'Old 1' },
        { url: 'https://old2.test', label: 'Old 2' },
      ],
    });
    const eventId = expectOk(created)!;
    expect((await readSources(eventId)).length).toBe(2);

    const upd = await as(p, 'contributor').rpc('update_event_sources', {
      p_event_id: eventId,
      p_urls: ['https://new.test'],
      p_labels: ['Only New'],
    });
    expectOk(upd);

    const rows = await readSources(eventId);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ url: 'https://new.test', label: 'Only New', sort_order: 1 });
  });

  it('update_event_sources with empty arrays clears all sources', async () => {
    const created = await createEvent(as(p, 'space_owner'), {
      title: 'S1b clear target',
      sources: [{ url: 'https://x.test', label: 'X' }],
    });
    const eventId = expectOk(created)!;
    const upd = await as(p, 'space_owner').rpc('update_event_sources', {
      p_event_id: eventId,
      p_urls: [],
      p_labels: [],
    });
    expectOk(upd);
    expect((await readSources(eventId)).length).toBe(0);
  });

  it('update_event_sources rejects mismatched url/label lengths (22023)', async () => {
    const created = await createEvent(as(p, 'space_owner'), { title: 'S1b mismatch' });
    const eventId = expectOk(created)!;
    const upd = await as(p, 'space_owner').rpc('update_event_sources', {
      p_event_id: eventId,
      p_urls: ['https://one.test', 'https://two.test'],
      p_labels: ['Only one'],
    });
    expectCode(upd, '22023');
  });

  it('update_event_sources on a missing event raises P0002', async () => {
    const upd = await as(p, 'space_owner').rpc('update_event_sources', {
      p_event_id: '00000000-0000-0000-0000-0000000bad00',
      p_urls: ['https://x.test'],
      p_labels: ['X'],
    });
    expectCode(upd, 'P0002');
  });
});

describe('S1b: event_sources RLS firewall', () => {
  it('a VIEWER cannot write sources through update_event_sources (42501)', async () => {
    const created = await createEvent(as(p, 'space_owner'), {
      title: 'S1b viewer denied',
      sources: [{ url: 'https://seed.test', label: 'Seed' }],
    });
    const eventId = expectOk(created)!;

    const upd = await as(p, 'reader').rpc('update_event_sources', {
      p_event_id: eventId,
      p_urls: ['https://reader.test'],
      p_labels: ['Reader'],
    });
    expectCode(upd, '42501');

    // The seeded source is untouched by the denied write.
    const rows = await readSources(eventId);
    expect(rows.length).toBe(1);
    expect(rows[0].url).toBe('https://seed.test');
  });

  it('a VIEWER cannot directly INSERT into event_sources (RLS denied)', async () => {
    const created = await createEvent(as(p, 'space_owner'), { title: 'S1b viewer direct insert' });
    const eventId = expectOk(created)!;

    const res = await as(p, 'reader')
      .from('event_sources')
      .insert({ event_id: eventId, url: 'https://sneaky.test', label: 'Sneaky' });
    // RLS write-check failure surfaces as a 42501.
    expect(res.error).not.toBeNull();
    expect(res.error!.code).toBe('42501');
    expect((await readSources(eventId)).length).toBe(0);
  });

  it('an owner/editor of the space CAN read the event_sources via RLS select', async () => {
    const created = await createEvent(as(p, 'space_owner'), {
      title: 'S1b member read',
      sources: [{ url: 'https://member.test', label: 'Member' }],
    });
    const eventId = expectOk(created)!;

    const { data, error } = await as(p, 'contributor')
      .from('event_sources')
      .select('url')
      .eq('event_id', eventId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
    expect((data ?? [])[0].url).toBe('https://member.test');
  });

  it('sibling-no-leak: a member of another space gets zero rows for this space event', async () => {
    const created = await createEvent(as(p, 'space_owner'), {
      title: 'S1b sibling no leak',
      sources: [{ url: 'https://secret.test', label: 'Secret' }],
    });
    const eventId = expectOk(created)!;

    // `no_memberships` owns the sibling space but is NOT a member of the
    // personas space -> RLS select returns zero rows (no error, just empty).
    const { data, error } = await as(p, 'no_memberships')
      .from('event_sources')
      .select('url')
      .eq('event_id', eventId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });
});
