import { describe, it, expect } from 'vitest';
import { buildFeedFilters } from './engagement-feed-filters';
import { ENTITY_TYPE_ICON } from '../../shared/constants/nav-icons';
import { IntelligenceEntityType } from '../../core/models/primary-intelligence.model';

const row = (entity_type: IntelligenceEntityType) => ({ entity_type });

describe('buildFeedFilters', () => {
  it('always emits the fixed scope set in order: All, Space, Company, Asset, Trial', () => {
    const filters = buildFeedFilters([]);
    expect(filters.map((f) => f.key)).toEqual(['all', 'space', 'company', 'product', 'trial']);
    expect(filters.map((f) => f.label)).toEqual(['All', 'Space', 'Company', 'Asset', 'Trial']);
  });

  it('keeps the Asset chip present even when no post is anchored to an asset', () => {
    const filters = buildFeedFilters([row('trial'), row('company'), row('space')]);
    const asset = filters.find((f) => f.key === 'product');
    expect(asset).toBeDefined();
    expect(asset?.count).toBe(0);
  });

  it('counts posts per scope and totals them on the All chip', () => {
    const filters = buildFeedFilters([
      row('trial'),
      row('trial'),
      row('company'),
      row('space'),
    ]);
    const byKey = Object.fromEntries(filters.map((f) => [f.key, f.count]));
    expect(byKey['all']).toBe(4);
    expect(byKey['trial']).toBe(2);
    expect(byKey['company']).toBe(1);
    expect(byKey['space']).toBe(1);
    expect(byKey['product']).toBe(0);
  });

  it('assigns the nav-rail icon to each entity chip and leaves All icon-less', () => {
    const filters = buildFeedFilters([]);
    const byKey = Object.fromEntries(filters.map((f) => [f.key, f.icon]));
    expect(byKey['all']).toBeUndefined();
    expect(byKey['trial']).toBe(ENTITY_TYPE_ICON['trial']);
    expect(byKey['company']).toBe(ENTITY_TYPE_ICON['company']);
    expect(byKey['product']).toBe(ENTITY_TYPE_ICON['product']);
    expect(byKey['space']).toBe(ENTITY_TYPE_ICON['space']);
  });
});
