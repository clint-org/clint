import { describe, expect, it } from 'vitest';

import { entityEventRowParams } from './entity-event-link';

describe('entityEventRowParams', () => {
  it('carries the entity scope plus the clicked event id for the detail pane', () => {
    expect(entityEventRowParams('trial', 'trial-1', 'ev-9')).toEqual({
      entityLevel: 'trial',
      entityId: 'trial-1',
      eventId: 'ev-9',
    });
  });

  it('works for product- and company-level profiles', () => {
    expect(entityEventRowParams('product', 'asset-2', 'ev-1').entityLevel).toBe('product');
    expect(entityEventRowParams('company', 'co-3', 'ev-2')).toMatchObject({
      entityId: 'co-3',
      eventId: 'ev-2',
    });
  });
});
