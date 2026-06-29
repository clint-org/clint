import { Marker } from './marker.model';

/**
 * Derived timeline membership (per the unified-events design): an event renders
 * a glyph on the timeline only when effectiveVisibility is true. pinned forces
 * on, hidden forces off, otherwise the effective significance (the event's own,
 * falling back to its type's default) must be 'high'. Low-significance events are
 * feed-only.
 */
export function effectiveVisibility(m: Marker): boolean {
  if (m.visibility === 'pinned') return true;
  if (m.visibility === 'hidden') return false;
  const sig = m.significance ?? m.marker_types?.default_significance ?? null;
  return sig === 'high';
}
