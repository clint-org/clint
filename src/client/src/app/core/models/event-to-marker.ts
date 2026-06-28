import { Marker } from './marker.model';

/**
 * Select string for reading an events-table row with its event type and the
 * type's category nested in. Shared by every read path that maps an event back
 * to the legacy Marker shape (trial timeline reads, marker CRUD reads).
 */
export const EVENTS_SELECT = `*, event_types(*, event_type_categories(*))`;

/**
 * Maps a raw events-table row to the Marker interface shape.
 * The only renames are:
 *   event_type_id  -> marker_type_id
 *   event_types    -> marker_types (with event_type_categories -> marker_categories inside)
 * All other column names are already 1:1 with Marker fields (including
 * anchor_id, which rides through on ...rest).
 * Pure function so it can be unit-tested without Supabase.
 */
export function mapEventToMarker(event: Record<string, unknown>): Marker {
  const { event_type_id, event_types, ...rest } = event;
  const eventTypes = (event_types ?? null) as Record<string, unknown> | null;
  return {
    ...rest,
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
