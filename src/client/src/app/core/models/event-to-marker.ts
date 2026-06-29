import { Marker } from './marker.model';

/**
 * Select string for reading an events-table row with its event type and the
 * type's category nested in. Shared by every read path that maps an event back
 * to the legacy Marker shape (trial timeline reads, marker CRUD reads).
 */
export const EVENTS_SELECT = `*, event_types(*, event_type_categories(*)), event_sources(url, label, sort_order)`;

/**
 * Maps a raw events-table row to the Marker interface shape.
 * The renames are:
 *   event_type_id  -> marker_type_id
 *   event_types    -> marker_types (with event_type_categories -> marker_categories inside)
 *   event_sources  -> sources (mapped to {url, label}, ordered by sort_order)
 * All other column names are already 1:1 with Marker fields (including
 * anchor_id, which rides through on ...rest).
 * `registry_url` is NOT derived here: the events row lacks the anchor trial's
 * identifier, so the derived CT.gov link is built at the display site that
 * holds the trial.
 * Pure function so it can be unit-tested without Supabase.
 */
export function mapEventToMarker(event: Record<string, unknown>): Marker {
  const { event_type_id, event_types, event_sources, ...rest } = event;
  const eventTypes = (event_types ?? null) as Record<string, unknown> | null;
  const sourceRows = (event_sources ?? []) as {
    url: string;
    label: string | null;
    sort_order?: number | null;
  }[];
  const sources = [...sourceRows]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((s) => ({ url: s.url, label: s.label ?? null }));
  return {
    ...rest,
    sources,
    marker_type_id: event_type_id,
    marker_types: eventTypes
      ? {
          ...eventTypes,
          marker_categories:
            (eventTypes['event_type_categories'] as Record<string, unknown> | null) ?? null,
        }
      : null,
  } as unknown as Marker;
}
