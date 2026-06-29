import { describe, it, expect } from 'vitest';
import type { CatalystDetail } from '../models/event-detail.model';
import { eventDetailFromWrapper } from './event-detail-map';

function wrapper(overrides: Partial<CatalystDetail['catalyst']> = {}): CatalystDetail {
  return {
    catalyst: {
      marker_id: 'ev-1',
      event_id: 'ev-1',
      space_id: 'sp-1',
      source_doc_id: null,
      title: 'Topline readout',
      event_date: '2026-09-15',
      date_precision: 'exact',
      end_date: null,
      end_date_precision: 'exact',
      is_ongoing: false,
      category_name: 'Clinical',
      category_id: 'cat-1',
      event_type_id: 'et-readout',
      marker_type_name: 'Readout',
      marker_type_color: '#16a34a',
      marker_type_shape: 'circle',
      marker_type_inner_mark: 'none',
      anchor_type: 'trial',
      anchor_id: 'tr-1',
      projection: 'forecasted',
      significance: null,
      visibility: null,
      is_projected: true,
      no_longer_expected: false,
      company_name: 'Acme Bio',
      company_id: 'co-1',
      company_logo_url: null,
      asset_name: 'ACME-123',
      asset_id: 'as-1',
      trial_name: 'A Phase 3 Study',
      trial_acronym: 'SUMMIT',
      trial_id: 'tr-1',
      trial_phase: 'P3',
      recruitment_status: 'RECRUITING',
      description: 'Primary endpoint met',
      source_url: null,
      sources: [{ id: 's1', url: 'https://fda.gov/x', label: 'FDA' }],
      registry_url: 'https://clinicaltrials.gov/study/NCT01',
      metadata: { tags: ['obesity', 'GLP-1'], pathway: 'BLA' },
      ctgov_last_synced_at: null,
      created_at: '2026-06-01T10:00:00Z',
      updated_at: '2026-06-02T10:00:00Z',
      ...overrides,
    },
    upcoming_markers: [],
    related_events: [],
  } as CatalystDetail;
}

describe('eventDetailFromWrapper', () => {
  it('maps the core flat fields from the wrapper catalyst', () => {
    const d = eventDetailFromWrapper(wrapper());
    expect(d).toMatchObject({
      id: 'ev-1',
      space_id: 'sp-1',
      title: 'Topline readout',
      event_date: '2026-09-15',
      description: 'Primary endpoint met',
      source_doc_id: null,
      created_at: '2026-06-01T10:00:00Z',
      updated_at: '2026-06-02T10:00:00Z',
      category: { id: 'cat-1', name: 'Clinical' },
      sources: [{ id: 's1', url: 'https://fda.gov/x', label: 'FDA' }],
      registry_url: 'https://clinicaltrials.gov/study/NCT01',
    });
  });

  it('maps significance -> priority (high stays high, null/low -> low)', () => {
    expect(eventDetailFromWrapper(wrapper({ significance: 'high' })).priority).toBe('high');
    expect(eventDetailFromWrapper(wrapper({ significance: 'low' })).priority).toBe('low');
    expect(eventDetailFromWrapper(wrapper({ significance: null })).priority).toBe('low');
  });

  it('reads tags from metadata, defaulting to [] when absent', () => {
    expect(eventDetailFromWrapper(wrapper()).tags).toEqual(['obesity', 'GLP-1']);
    expect(eventDetailFromWrapper(wrapper({ metadata: null })).tags).toEqual([]);
    expect(eventDetailFromWrapper(wrapper({ metadata: { pathway: 'BLA' } })).tags).toEqual([]);
  });

  it('derives entity_level from anchor_type (asset -> product) with the right entity_name', () => {
    const trial = eventDetailFromWrapper(wrapper());
    expect(trial.entity_level).toBe('trial');
    expect(trial.entity_name).toBe('SUMMIT'); // acronym preferred
    expect(trial.entity_id).toBe('tr-1');

    const asset = eventDetailFromWrapper(
      wrapper({ anchor_type: 'asset', anchor_id: 'as-1' }),
    );
    expect(asset.entity_level).toBe('product');
    expect(asset.entity_name).toBe('ACME-123');

    const company = eventDetailFromWrapper(
      wrapper({ anchor_type: 'company', anchor_id: 'co-1' }),
    );
    expect(company.entity_level).toBe('company');
    expect(company.entity_name).toBe('Acme Bio');

    const space = eventDetailFromWrapper(wrapper({ anchor_type: 'space', anchor_id: null }));
    expect(space.entity_level).toBe('space');
    expect(space.entity_id).toBeNull();
  });

  it('falls back to trial_name when the acronym is missing', () => {
    expect(eventDetailFromWrapper(wrapper({ trial_acronym: null })).entity_name).toBe(
      'A Phase 3 Study',
    );
  });

  it('nulls the retired thread/links + audit-author fields (rebuilt later)', () => {
    const d = eventDetailFromWrapper(wrapper());
    expect(d.thread).toBeNull();
    expect(d.linked_events).toEqual([]);
    expect(d.thread_id).toBeNull();
    expect(d.created_by).toBeNull();
  });
});
