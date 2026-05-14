-- =============================================================================
-- intelligence: rename thesis_md -> summary_md, drop watch_md
-- =============================================================================
--
-- "Thesis" reads as analytical pretension for a one-paragraph editorial read.
-- Rename to "Summary" everywhere. "What to watch" was a distinct field in the
-- editor but in practice readers want the read in one place: drop it. Data
-- loss is intentional; the seed and frontend stop offering the field.
--
-- This migration:
--   1. Drops the old upsert_primary_intelligence (signature change: p_watch_md
--      removed, p_thesis_md -> p_summary_md).
--   2. ALTERs primary_intelligence: rename thesis_md -> summary_md, drop
--      watch_md.
--   3. Recreates upsert_primary_intelligence with the new signature.
--   4. Recreates the read RPCs that hard-code thesis_md / watch_md in their
--      jsonb output: list_draft_intelligence_for_space, list_primary_intelligence,
--      get_primary_intelligence_history. build_intelligence_payload uses
--      to_jsonb(record) so it auto-adopts the new column shape -- no rewrite.
--   5. Recreates _seed_demo_primary_intelligence so the seed.sql call site
--      keeps working after the column drop. Watch content is discarded.
--   6. Smoke test exercises every replaced RPC against a random uuid.

-- -----------------------------------------------------------------------------
-- 1. drop the old upsert signature so we can re-create it with new params
-- -----------------------------------------------------------------------------

drop function if exists public.upsert_primary_intelligence(
  uuid, uuid, text, uuid, text, text, text, text, text, text, jsonb
);

-- -----------------------------------------------------------------------------
-- 2. column rename + drop
-- -----------------------------------------------------------------------------

alter table public.primary_intelligence rename column thesis_md to summary_md;
alter table public.primary_intelligence drop column watch_md;

comment on column public.primary_intelligence.summary_md is
  'One-paragraph editorial summary (markdown). Renamed from thesis_md 2026-05-12 to drop analytical-pretension framing.';

-- -----------------------------------------------------------------------------
-- 3. upsert_primary_intelligence (new signature, no p_watch_md)
-- -----------------------------------------------------------------------------

create or replace function public.upsert_primary_intelligence(
  p_id              uuid,
  p_space_id        uuid,
  p_entity_type     text,
  p_entity_id       uuid,
  p_headline        text,
  p_summary_md      text,
  p_implications_md text,
  p_state           text,
  p_change_note     text,
  p_links           jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_agency_member_of_space(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_state not in ('draft','published') then
    raise exception 'invalid state %', p_state using errcode = '22023';
  end if;
  if p_entity_type not in ('trial', 'marker', 'company', 'product', 'space') then
    raise exception 'invalid entity_type %', p_entity_type using errcode = '22023';
  end if;

  if p_state = 'published' then
    -- enforce change_note when any prior non-draft version exists for this anchor
    if exists (
      select 1 from public.primary_intelligence
       where space_id    = p_space_id
         and entity_type = p_entity_type
         and entity_id   = p_entity_id
         and state in ('published','archived','withdrawn')
         and id is distinct from p_id
    ) and (p_change_note is null or length(trim(p_change_note)) = 0) then
      raise exception 'change_note required when republishing'
        using errcode = '22023';
    end if;

    -- archive any prior published row for this anchor.
    update public.primary_intelligence
       set state       = 'archived',
           archived_at = now()
     where space_id    = p_space_id
       and entity_type = p_entity_type
       and entity_id   = p_entity_id
       and state       = 'published'
       and id is distinct from p_id;
  end if;

  if p_id is null then
    insert into public.primary_intelligence (
      space_id, entity_type, entity_id, state, headline,
      summary_md, implications_md,
      publish_note, published_by, last_edited_by
    ) values (
      p_space_id, p_entity_type, p_entity_id, p_state, p_headline,
      coalesce(p_summary_md, ''),
      coalesce(p_implications_md, ''),
      case when p_state = 'published' then nullif(trim(coalesce(p_change_note, '')), '') else null end,
      case when p_state = 'published' then auth.uid() else null end,
      auth.uid()
    )
    returning id into v_id;
  else
    update public.primary_intelligence
       set state = p_state,
           headline = p_headline,
           summary_md = coalesce(p_summary_md, ''),
           implications_md = coalesce(p_implications_md, ''),
           publish_note = case
             when p_state = 'published' and publish_note is null
               then nullif(trim(coalesce(p_change_note, '')), '')
             else publish_note
           end,
           published_by = case
             when p_state = 'published' and published_by is null then auth.uid()
             else published_by
           end,
           last_edited_by = auth.uid(),
           updated_at = now()
     where id = p_id
       and space_id = p_space_id
    returning id into v_id;

    if v_id is null then
      raise exception 'primary_intelligence % not found in space %', p_id, p_space_id
        using errcode = 'P0002';
    end if;
  end if;

  delete from public.primary_intelligence_links
   where primary_intelligence_id = v_id;

  if p_links is not null and jsonb_array_length(p_links) > 0 then
    insert into public.primary_intelligence_links (
      primary_intelligence_id, entity_type, entity_id,
      relationship_type, gloss, display_order
    )
    select v_id,
           (l->>'entity_type')::text,
           (l->>'entity_id')::uuid,
           (l->>'relationship_type')::text,
           nullif(l->>'gloss', ''),
           coalesce((l->>'display_order')::int, 0)
      from jsonb_array_elements(p_links) l;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.upsert_primary_intelligence(
  uuid, uuid, text, uuid, text, text, text, text, text, jsonb
) from public;
revoke execute on function public.upsert_primary_intelligence(
  uuid, uuid, text, uuid, text, text, text, text, text, jsonb
) from anon;
grant execute on function public.upsert_primary_intelligence(
  uuid, uuid, text, uuid, text, text, text, text, text, jsonb
) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. list_draft_intelligence_for_space (replace thesis_md -> summary_md)
-- -----------------------------------------------------------------------------

create or replace function public.list_draft_intelligence_for_space(
  p_space_id uuid,
  p_limit    int default 3
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_data order by updated_at desc), '[]'::jsonb)
  from (
    select
      jsonb_build_object(
        'id', p.id,
        'space_id', p.space_id,
        'entity_type', p.entity_type,
        'entity_id', p.entity_id,
        'state', p.state,
        'headline', p.headline,
        'summary_md', p.summary_md,
        'last_edited_by', p.last_edited_by,
        'updated_at', p.updated_at,
        'links', '[]'::jsonb,
        'contributors', case
          when p.last_edited_by is null then '[]'::jsonb
          else jsonb_build_array(p.last_edited_by)
        end
      ) as row_data,
      p.updated_at
    from public.primary_intelligence p
    where p.space_id = p_space_id
      and p.state = 'draft'
    order by p.updated_at desc
    limit p_limit
  ) ordered;
$$;

revoke execute on function public.list_draft_intelligence_for_space(uuid, int) from public;
revoke execute on function public.list_draft_intelligence_for_space(uuid, int) from anon;
grant  execute on function public.list_draft_intelligence_for_space(uuid, int) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. list_primary_intelligence (replace thesis_md -> summary_md)
-- -----------------------------------------------------------------------------

create or replace function public.list_primary_intelligence(
  p_space_id                  uuid,
  p_entity_types              text[]        default null,
  p_author_id                 uuid          default null,
  p_since                     timestamptz   default null,
  p_query                     text          default null,
  p_referencing_entity_type   text          default null,
  p_referencing_entity_id     uuid          default null,
  p_limit                     int           default 50,
  p_offset                    int           default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_total int;
  v_query_pattern text;
begin
  v_query_pattern := case
    when p_query is null or length(trim(p_query)) = 0 then null
    else '%' || lower(trim(p_query)) || '%'
  end;

  with base as (
    select p.*
    from public.primary_intelligence p
    where p.space_id = p_space_id
      and p.state = 'published'
      and (p_entity_types is null or p.entity_type = any(p_entity_types))
      and (p_since is null or p.updated_at >= p_since)
      and (
        v_query_pattern is null
        or lower(p.headline) like v_query_pattern
        or lower(p.summary_md) like v_query_pattern
      )
      and (
        p_author_id is null
        or p.last_edited_by = p_author_id
      )
      and (
        p_referencing_entity_type is null
        or p_referencing_entity_id is null
        or exists (
          select 1 from public.primary_intelligence_links l
          where l.primary_intelligence_id = p.id
            and l.entity_type = p_referencing_entity_type
            and l.entity_id = p_referencing_entity_id
        )
      )
  ), counted as (
    select count(*)::int as total from base
  ), paged as (
    select * from base
    order by updated_at desc
    limit greatest(p_limit, 0)
    offset greatest(p_offset, 0)
  )
  select
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', x.id,
            'space_id', x.space_id,
            'entity_type', x.entity_type,
            'entity_id', x.entity_id,
            'state', x.state,
            'headline', x.headline,
            'summary_md', x.summary_md,
            'last_edited_by', x.last_edited_by,
            'updated_at', x.updated_at,
            'links', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'entity_type', l.entity_type,
                    'entity_id', l.entity_id,
                    'relationship_type', l.relationship_type,
                    'gloss', l.gloss
                  )
                  order by l.display_order, l.created_at
                )
                from public.primary_intelligence_links l
                where l.primary_intelligence_id = x.id
              ),
              '[]'::jsonb
            ),
            'contributors', case
              when x.last_edited_by is null then '[]'::jsonb
              else jsonb_build_array(x.last_edited_by)
            end
          )
          order by x.updated_at desc
        )
        from paged x
      ),
      '[]'::jsonb
    ),
    (select total from counted)
  into v_rows, v_total;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset
  );
end;
$$;

revoke execute on function public.list_primary_intelligence(
  uuid, text[], uuid, timestamptz, text, text, uuid, int, int
) from public;
revoke execute on function public.list_primary_intelligence(
  uuid, text[], uuid, timestamptz, text, text, uuid, int, int
) from anon;
grant  execute on function public.list_primary_intelligence(
  uuid, text[], uuid, timestamptz, text, text, uuid, int, int
) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. get_primary_intelligence_history (replace thesis_md/watch_md)
-- -----------------------------------------------------------------------------

create or replace function public.get_primary_intelligence_history(
  p_space_id    uuid,
  p_entity_type text,
  p_entity_id   uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_can_read boolean;
begin
  v_can_read := public.is_agency_member_of_space(p_space_id)
                or public.has_space_access(p_space_id);
  if not v_can_read then
    return null;
  end if;

  return (
    with rows as (
      select * from public.primary_intelligence p
       where p.space_id    = p_space_id
         and p.entity_type = p_entity_type
         and p.entity_id   = p_entity_id
    ),
    current_row as (
      select * from rows where state = 'published' limit 1
    ),
    draft_row as (
      select * from rows where state = 'draft' order by updated_at desc limit 1
    ),
    versions as (
      select * from rows where state in ('published','archived','withdrawn')
    ),
    versions_with_base as (
      select v.*,
             (
               select v2.id
                 from versions v2
                where v2.version_number < v.version_number
                  and v2.published_at is not null
                  and v2.withdrawn_at is null
                order by v2.version_number desc
                limit 1
             ) as diff_base_id
        from versions v
    ),
    version_links as (
      select
        l.primary_intelligence_id as row_id,
        jsonb_agg(
          jsonb_build_object(
            'entity_type',       l.entity_type,
            'entity_id',         l.entity_id,
            'entity_name', case l.entity_type
              when 'trial'   then (select tr.name  from public.trials    tr where tr.id = l.entity_id)
              when 'marker'  then (select mk.title from public.markers   mk where mk.id = l.entity_id)
              when 'company' then (select co.name  from public.companies co where co.id = l.entity_id)
              when 'product' then (select pr.name  from public.products  pr where pr.id = l.entity_id)
              else null
            end,
            'relationship_type', l.relationship_type,
            'gloss',             l.gloss,
            'display_order',     l.display_order
          )
          order by l.display_order, l.created_at
        ) as links
      from public.primary_intelligence_links l
      join versions_with_base v on v.id = l.primary_intelligence_id
      group by l.primary_intelligence_id
    ),
    events as (
      select created_at as at, 'draft_started'::text as kind, id as row_id,
             null::int as version_number, last_edited_by as by, null::text as note
        from rows
      union all
      select published_at, 'published', id, version_number, published_by, publish_note
        from rows where published_at is not null
      union all
      select archived_at, 'archived', id, version_number, null, null
        from rows where archived_at is not null
      union all
      select withdrawn_at, 'withdrawn', id, version_number, withdrawn_by, withdraw_note
        from rows where withdrawn_at is not null
    )
    select jsonb_build_object(
      'current', (select to_jsonb(c) from current_row c),
      'draft',   (select to_jsonb(d) from draft_row d),
      'versions', coalesce(
        (select jsonb_agg(
          jsonb_build_object(
            'id',              v.id,
            'version_number',  v.version_number,
            'state',           v.state,
            'headline',        v.headline,
            'summary_md',      v.summary_md,
            'implications_md', v.implications_md,
            'publish_note',    v.publish_note,
            'published_at',    v.published_at,
            'published_by',    v.published_by,
            'archived_at',     v.archived_at,
            'withdrawn_at',    v.withdrawn_at,
            'withdrawn_by',    v.withdrawn_by,
            'withdraw_note',   v.withdraw_note,
            'diff_base_id',    v.diff_base_id,
            'links',           coalesce(vl.links, '[]'::jsonb)
          )
          order by v.version_number desc
        )
          from versions_with_base v
          left join version_links vl on vl.row_id = v.id
        ),
        '[]'::jsonb
      ),
      'events', coalesce(
        (select jsonb_agg(
          jsonb_build_object(
            'at',             e.at,
            'kind',           e.kind,
            'row_id',         e.row_id,
            'version_number', e.version_number,
            'by',             e.by,
            'note',           e.note
          )
          order by
            e.at asc,
            case e.kind
              when 'draft_started' then 0
              when 'published'     then 1
              when 'archived'      then 2
              when 'withdrawn'     then 3
            end
        ) from events e),
        '[]'::jsonb
      )
    )
  );
end;
$$;

revoke execute on function public.get_primary_intelligence_history(uuid, text, uuid) from public;
revoke execute on function public.get_primary_intelligence_history(uuid, text, uuid) from anon;
grant  execute on function public.get_primary_intelligence_history(uuid, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. _seed_demo_primary_intelligence (drop watch_md from inserts; rename)
-- -----------------------------------------------------------------------------
-- Mirrors the 20260502130000 cardiometabolic seed but writes summary_md
-- without a watch_md value. The "what to watch" prose is dropped on purpose;
-- the read now lives in summary + implications only.

create or replace function public._seed_demo_primary_intelligence(
  p_space_id uuid,
  p_uid uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t_summit         uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_summit');
  t_redefine_1     uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_redefine_1');
  t_sequoia_hcm    uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_sequoia_hcm');
  t_fineart_hf     uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_fineart_hf');
  t_vk2735_sc_p2   uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_vk2735_sc_p2');
  t_attribute_cm   uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_attribute_cm');
  t_attr_act       uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_attr_act');
  t_maritide_p2    uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_maritide_p2');
  t_attain_1       uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_attain_1');
  t_achieve_1      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_achieve_1');
  t_maple_hcm      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_maple_hcm');
  t_deliver        uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_deliver');
  t_emperor_preserved uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_emperor_preserved');
  t_paradigm_hf    uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_paradigm_hf');

  c_apex     uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_apex');
  c_helios   uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_helios');
  c_solara   uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_solara');
  c_meridian uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_meridian');
  c_vantage  uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_vantage');
  c_cascade  uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_cascade');

  p_farxiga      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_farxiga');
  p_jardiance    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_jardiance');
  p_kerendia     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_kerendia');
  p_entresto     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_entresto');
  p_wegovy       uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_wegovy');
  p_zepbound     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_zepbound');
  p_retatrutide  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_retatrutide');
  p_vk2735_sc    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vk2735_sc');
  p_camzyos      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_camzyos');
  p_vyndaqel     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vyndaqel');
  p_orforglipron uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_orforglipron');
  p_rybelsus     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_rybelsus');
  p_azd5004      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_azd5004');
  p_danuglipron  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_danuglipron');
  p_maritide     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_maritide');
  p_mounjaro     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_mounjaro');

  m_orforglipron_read uuid := (select id from _seed_ids where entity_type = 'marker' and key = 'm_orforglipron_read');

  pi_summit       uuid := gen_random_uuid();
  pi_redefine     uuid := gen_random_uuid();
  pi_sequoia      uuid := gen_random_uuid();
  pi_finearts     uuid := gen_random_uuid();
  pi_vk2735       uuid := gen_random_uuid();
  pi_attribute    uuid := gen_random_uuid();
  pi_pfizer       uuid := gen_random_uuid();
  pi_thematic     uuid := gen_random_uuid();
  pi_orfo_draft   uuid := gen_random_uuid();
  pi_maritide_d   uuid := gen_random_uuid();
begin
  -- Read 1: SUMMIT trial
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_summit, p_space_id, 'trial', t_summit, 'published',
    'Tirzepatide HFpEF readout puts a GLP-1 in the cardiology guideline conversation for the first time',
    E'SUMMIT is the first dedicated outcomes trial showing that a GLP-1-class agent improves both KCCQ-CSS and clinical events in obese HFpEF patients. The composite of CV death and worsening HF events came in favorable, with KCCQ-CSS effect roughly twice the magnitude of the SGLT2 HFpEF wins. The competitive read: tirzepatide is no longer just an obesity drug, it is now a credible HFpEF treatment that will compete for guideline real estate alongside SGLT2 inhibitors and finerenone.',
    E'A guideline-grade HFpEF position for tirzepatide expands the addressable cardiology budget meaningfully. Reframes the competitive map: the HFpEF lane now includes incretins, SGLT2is, and nsMRAs, with combination therapy the likely steady state. Recommend cardiology KOL outreach in the next 60 days.',
    p_uid, now() - interval '14 days', now() - interval '14 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_summit, 'product', p_farxiga,   'Same class',     'SGLT2 incumbent in HFpEF', 0),
    (pi_summit, 'product', p_jardiance, 'Competitor',     'SGLT2 incumbent in HFpEF', 1),
    (pi_summit, 'product', p_kerendia,  'Same class',     'nsMRA HFpEF entrant',      2),
    (pi_summit, 'product', p_entresto,  'Predecessor',    'ARNI HFrEF predecessor',   3);

  -- Read 2: REDEFINE-1 trial
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_redefine, p_space_id, 'trial', t_redefine_1, 'published',
    'CagriSema misses 25% bar: Novos combo defense thesis under structural pressure',
    E'REDEFINE-1 delivered 22.7% weight loss at 68 weeks, below the ~25% bar Street consensus had built around CagriSema as the next-generation Novo defense against tirzepatide. The amylin combination thesis (additive to GLP-1) is not invalidated but the magnitude of incremental benefit is smaller than priced. Stock down 20% on the day reflects a structural rerating of Novos pipeline value rather than a simple miss.',
    E'Repositions Novo as a defender rather than a class-defining innovator in obesity. M&A and licensing posture likely to shift; Novo may need to acquire next-class assets rather than rely on internal combos. Recommend reviewing Novo BD activity and investor messaging at next earnings.',
    p_uid, now() - interval '13 days', now() - interval '13 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_redefine, 'product', p_wegovy,      'Predecessor',    'Same molecule, single-agent', 0),
    (pi_redefine, 'product', p_zepbound,    'Competitor',     'Tirzepatide obesity benchmark', 1),
    (pi_redefine, 'product', p_retatrutide, 'Future window',  'Next-class triple agonist',     2),
    (pi_redefine, 'product', p_vk2735_sc,   'Future window',  'Challenger GIP/GLP-1',          3);

  -- Read 3: SEQUOIA-HCM trial
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_sequoia, p_space_id, 'trial', t_sequoia_hcm, 'published',
    'Aficamten NDA filed: Cytokinetics vs BMS Camzyos becomes a real two-horse race',
    E'Cytokinetics filed the aficamten NDA for oHCM in Q3 2024 on the basis of a SEQUOIA-HCM readout that closely tracks EXPLORER-HCM with a cleaner safety story. The competitive setup post-PDUFA is now genuinely contested: BMS Camzyos has first-mover scale, but aficamten has a meaningfully simpler dosing regimen and faster onset. The HCM market expands fastest if both products co-promote diagnosis, slowest if they trench around incumbent prescribers.',
    E'A two-product oHCM market drives diagnosis volume up; both companies benefit if the segment doubles. Recommend a refreshed market sizing within 60 days assuming both are launched. Watch for partnership or co-promote commentary, especially from Cytokinetics on commercial scale-up.',
    p_uid, now() - interval '11 days', now() - interval '11 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_sequoia, 'product', p_camzyos,    'Competitor',  'BMS first-mover in oHCM',    0),
    (pi_sequoia, 'company', c_solara,     'Same class',  'Cytokinetics myosin platform', 1),
    (pi_sequoia, 'company', c_helios,     'Competitor',  'BMS HCM franchise',           2),
    (pi_sequoia, 'trial',   t_maple_hcm,  'Future window', 'Next aficamten readout',    3);

  -- Read 4: FINEARTS-HF trial
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_finearts, p_space_id, 'trial', t_fineart_hf, 'published',
    'Finerenone HFpEF win opens a non-SGLT2 / non-ARNI lane in HFpEF',
    E'FINEARTS-HF is the first nsMRA win in HFpEF/HFmrEF, with a 16% reduction in CV death and total HF events over a 32-month median follow-up. The clinical implication is meaningful: HFpEF treatment can no longer be characterized as SGLT2-only. The combination treatment cocktail (SGLT2 + finerenone, plus the GLP-1 lane opening from SUMMIT) is the new HFpEF reality, and that has implications for both cardiology economics and trial design.',
    E'HFpEF as a multi-mechanism disease unlocks combination economics for cardiology benefits managers. Recommend updating the HFpEF treatment-cocktail forecast assuming SGLT2 + finerenone as the new baseline, with tirzepatide layered on for obese HFpEF.',
    p_uid, now() - interval '9 days', now() - interval '9 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_finearts, 'trial', t_deliver,           'Same class',  'Dapagliflozin HFpEF win',         0),
    (pi_finearts, 'trial', t_emperor_preserved, 'Same class',  'Empagliflozin HFpEF win',         1),
    (pi_finearts, 'trial', t_paradigm_hf,       'Predecessor', 'Entresto HFrEF; PARAGON-HF HFpEF non-win read-across', 2);

  -- Read 5: VK2735 SC P2 trial
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_vk2735, p_space_id, 'trial', t_vk2735_sc_p2, 'published',
    'Viking VK2735 P2: takeout target or independent path, both scenarios under-priced',
    E'VK2735 SC delivered ~13-15% body weight reduction at 13 weeks, competitive with the front of the tirzepatide and semaglutide ramp. Viking is now under serious M&A consideration and the question is whether takeout pricing reflects a one-asset thesis (VK2735) or a platform thesis (oral analog, NASH, broader cardiometabolic). The asymmetry in the market is that takeout floors keep moving up as P3 readout proximity increases, while standalone valuation requires a P3 readout to be priced fully.',
    E'Both takeout and independent paths are worth modeling because Viking captures upside in both. Recommend updating the BD-target watch with Viking near the top of the obesity asset queue.',
    p_uid, now() - interval '7 days', now() - interval '7 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_vk2735, 'product', p_zepbound,  'Competitor',     'Tirzepatide obesity benchmark', 0),
    (pi_vk2735, 'product', p_wegovy,    'Competitor',     'Semaglutide obesity benchmark', 1),
    (pi_vk2735, 'product', p_maritide,  'Same class',     'Differentiated incretin combo', 2),
    (pi_vk2735, 'company', c_cascade,   'Future window',  'Roche obesity acquirer profile',3);

  -- Read 6: ATTRibute-CM trial
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_attribute, p_space_id, 'trial', t_attribute_cm, 'published',
    'Acoramidis launches into a Vyndaqel-saturated market: switching dynamics will define 2026',
    E'BridgeBio Attruby launched December 2024 into a Vyndaqel-saturated ATTR-CM market. The clinical case for switching is supportable but not overwhelming: ATTRibute-CM was placebo-controlled, no head-to-head data exist, and Vyndaqel has multi-year real-world experience plus established prior-auth pathways. The 2026 question is how aggressively cardiology specialty pharmacies and TTR-CM specialists test switching, and whether payers create switch-friendly utilization management.',
    E'Switching velocity is the key 2026 metric. Recommend a quarterly tracker on specialty pharmacy script data plus payer policy changes. Both companies likely benefit from market expansion (undiagnosed pool) as long as awareness investments continue.',
    p_uid, now() - interval '5 days', now() - interval '5 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_attribute, 'product', p_vyndaqel, 'Competitor',  'Pfizer first-mover ATTR-CM', 0),
    (pi_attribute, 'company', c_apex,     'Competitor',  'Pfizer ATTR-CM franchise',   1),
    (pi_attribute, 'trial',   t_attr_act, 'Predecessor', 'Vyndaqel pivotal trial',     2);

  -- Read 7: Pfizer (company)
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_pfizer, p_space_id, 'company', c_apex, 'published',
    'Pfizers cardiometabolic exit: danuglipron discontinuation reframes the GLP-1 oral race',
    E'Pfizer halted danuglipron in December 2023 after high incidence of adverse events, effectively ending Pfizers near-term oral GLP-1 ambitions. The signal value is greater than the asset value: the drug class is structurally harder for small molecules than for peptides, which reads through to Lilly orforglipron and AZD5004. Pfizer has since signaled a shift away from cardiometabolic R&D, leaving Vyndaqel as the franchises remaining anchor.',
    E'Pfizers exit narrows the oral GLP-1 field meaningfully and concentrates risk on Lilly. Recommend updating the oral-GLP-1 race scoreboard and re-pricing implied probabilities of success for orforglipron given the cleaner field.',
    p_uid, now() - interval '4 days', now() - interval '4 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_pfizer, 'product', p_orforglipron, 'Future window', 'Next oral GLP-1 readout',         0),
    (pi_pfizer, 'product', p_rybelsus,     'Same class',    'Approved oral GLP-1 (peptide)',   1),
    (pi_pfizer, 'product', p_azd5004,      'Competitor',    'AZ oral GLP-1 entrant',           2);

  -- Read 8: Space (engagement-thematic)
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_thematic, p_space_id, 'space', p_space_id, 'published',
    'Cardiometabolic catalyst cluster H2 2026: TRIUMPH-1, ATTAIN-1, ACHIEVE-1, MAPLE-HCM in one window',
    E'Four decision-grade catalysts cluster across May-October 2026: ATTAIN-1 (orforglipron obesity), ACHIEVE-1 (orforglipron T2D), TRIUMPH-1 (retatrutide obesity), and MAPLE-HCM (aficamten head-to-head). Three are Lilly-anchored, one is Cytokinetics. The cluster compresses analyst and KOL bandwidth and creates short windows where multiple readouts must be interpreted in parallel.',
    E'Recommend a daily cadence briefing during the May-October 2026 window plus pre-positioning analyst notes 2-3 weeks before each readout. Cluster-window coverage is the single most leveraged use of analyst time this year.',
    p_uid, now() - interval '2 days', now() - interval '2 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_thematic, 'company', c_meridian, 'Future window', 'Lilly multi-asset readout cluster', 0),
    (pi_thematic, 'company', c_vantage,  'Future window', 'Novo defensive positioning',        1),
    (pi_thematic, 'company', c_solara,   'Future window', 'Cytokinetics MAPLE-HCM readout',    2);

  -- Read 9: Draft, orforglipron readout marker
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_orfo_draft, p_space_id, 'marker', m_orforglipron_read, 'draft',
    'Pre-read framework for the orforglipron Phase 3 cluster',
    E'Drafting the pre-read framework before ATTAIN-1 and ACHIEVE-1 readouts. Three scenarios: (1) clean efficacy + clean tolerability validates oral GLP-1 as a credible peptide alternative; (2) acceptable efficacy with GI tolerability matching SC peptides keeps the oral lane open but commercially constrained; (3) tolerability footprint resembling danuglipron triggers a re-rating of the entire small-molecule GLP-1 thesis.',
    E'',
    p_uid, now() - interval '6 hours', now() - interval '6 hours'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_orfo_draft, 'trial',   t_attain_1,     'Future window', 'Obesity P3 readout',      0),
    (pi_orfo_draft, 'trial',   t_achieve_1,    'Future window', 'T2D P3 readout',          1),
    (pi_orfo_draft, 'product', p_danuglipron,  'Predecessor',   'Pfizer oral GLP-1 failure', 2);

  -- Read 10: Draft, MariTide P2 trial
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_maritide_d, p_space_id, 'trial', t_maritide_p2, 'draft',
    'MariTide differentiation thesis: GIPR antagonism vs agonism',
    E'MariTide is the only late-stage incretin program betting on GIPR antagonism rather than agonism (combined with GLP-1 agonism). The mechanistic case rests on whether GIPR signaling drives or counters obesity in chronic dosing. P2 readout supports the antagonism hypothesis but the magnitude of effect (~20% at 52 weeks) is competitive rather than category-leading. Drafting the second-mover positioning thesis ahead of P3 design announcements.',
    E'',
    p_uid, now() - interval '2 hours', now() - interval '2 hours'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_maritide_d, 'product', p_mounjaro,   'Same class',  'GIP/GLP-1 dual agonist incumbent', 0),
    (pi_maritide_d, 'product', p_zepbound,   'Competitor',  'Tirzepatide obesity benchmark',    1),
    (pi_maritide_d, 'product', p_vk2735_sc,  'Same class',  'Other GIP/GLP-1 challenger',       2);
end;
$$;

comment on function public._seed_demo_primary_intelligence(uuid, uuid) is
  'Seeds 8 published primary intelligence reads (6 trial-anchored, 1 company-anchored, 1 space-thematic) plus 2 drafts. Writes summary_md (no watch_md) per 20260512000000.';

-- -----------------------------------------------------------------------------
-- 8. smoke test
-- -----------------------------------------------------------------------------

do $$
declare
  v_drafts jsonb;
  v_list   jsonb;
  v_hist   jsonb;
  v_fake   uuid := gen_random_uuid();
begin
  v_drafts := public.list_draft_intelligence_for_space(v_fake, 3);
  v_list   := public.list_primary_intelligence(
                v_fake, null, null, null, null, null, null, 5, 0
              );
  v_hist   := public.get_primary_intelligence_history(v_fake, 'trial', v_fake);
end $$;
