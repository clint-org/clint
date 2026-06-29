// Pure adapter: unwrap the unified get_event_detail wrapper ({catalyst, ...}) into the flat
// EventDetail the events-page detail() branch renders. The Stage 3 IA rename gave the wrapper the
// get_event_detail name (markers + edit-hydration need its richer shape); analyst-event rows on
// the events page still want the flat shape, so we adapt here rather than add a second RPC.
// thread / linked_events are nulled until the links/threads feature is rebuilt.

import type { CatalystDetail } from '../models/catalyst.model';
import type { EntityLevel, EventDetail } from '../models/event.model';

function entityLevelFromAnchor(anchorType: CatalystDetail['catalyst']['anchor_type']): EntityLevel {
  return anchorType === 'asset' ? 'product' : anchorType;
}

function entityName(c: CatalystDetail['catalyst']): string {
  switch (c.anchor_type) {
    case 'trial':
      return c.trial_acronym ?? c.trial_name ?? '';
    case 'asset':
      return c.asset_name ?? '';
    case 'company':
      return c.company_name ?? '';
    case 'space':
      return '';
  }
}

export function eventDetailFromWrapper(wrapper: CatalystDetail): EventDetail {
  const c = wrapper.catalyst;
  const tags = Array.isArray(c.metadata?.['tags']) ? (c.metadata['tags'] as string[]) : [];
  return {
    id: c.event_id,
    source_doc_id: c.source_doc_id,
    space_id: c.space_id,
    title: c.title,
    event_date: c.event_date,
    description: c.description,
    priority: c.significance === 'high' ? 'high' : 'low',
    tags,
    thread_id: null,
    thread_order: null,
    created_by: null,
    created_at: c.created_at,
    updated_at: c.updated_at,
    updated_by: null,
    category: { id: c.category_id, name: c.category_name },
    entity_level: entityLevelFromAnchor(c.anchor_type),
    entity_name: entityName(c),
    entity_id: c.anchor_id,
    company_name: c.company_name,
    company_id: c.company_id,
    asset_id: c.asset_id,
    // get_event_detail always emits the source id; coalesce to satisfy the type
    // for the (dashboard-flattened) Catalyst shapes where it is optional.
    sources: (c.sources ?? []).map((s) => ({ id: s.id ?? '', url: s.url, label: s.label })),
    registry_url: c.registry_url ?? null,
    thread: null,
    linked_events: [],
  };
}
