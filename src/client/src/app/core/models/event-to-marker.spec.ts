import { describe, expect, it } from 'vitest';

import { EVENTS_SELECT, mapEventToMarker } from './event-to-marker';

describe('EVENTS_SELECT', () => {
  it('embeds event_sources alongside the event type and category', () => {
    expect(EVENTS_SELECT).toBe(
      '*, event_types(*, event_type_categories(*)), event_sources(url, label, sort_order)'
    );
  });
});

describe('mapEventToMarker', () => {
  it('renames event_type_id and nests the category under marker_types', () => {
    const marker = mapEventToMarker({
      id: 'marker-1',
      event_type_id: 'type-1',
      event_types: {
        id: 'type-1',
        name: 'Data Readout',
        event_type_categories: { id: 'cat-1', name: 'Clinical Data' },
      },
    });

    expect(marker.marker_type_id).toBe('type-1');
    expect(marker.marker_types?.marker_categories?.name).toBe('Clinical Data');
  });

  it('carries embedded event_sources onto the marker as sources, sorted by sort_order', () => {
    const marker = mapEventToMarker({
      id: 'marker-1',
      event_type_id: 'type-1',
      event_types: null,
      event_sources: [
        { url: 'https://b.example/2', label: 'Second', sort_order: 2 },
        { url: 'https://a.example/1', label: null, sort_order: 1 },
      ],
    });

    expect(marker.sources).toEqual([
      { url: 'https://a.example/1', label: null },
      { url: 'https://b.example/2', label: 'Second' },
    ]);
  });

  it('returns an empty sources array when no citations are embedded', () => {
    const marker = mapEventToMarker({
      id: 'marker-1',
      event_type_id: 'type-1',
      event_types: null,
    });

    expect(marker.sources).toEqual([]);
  });
});
