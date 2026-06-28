import { describe, expect, it } from 'vitest';

import { MaterialLink } from '../../../core/models/material.model';
import { routeForLink } from './material-link-route';

const TENANT = 'tenant-1';
const SPACE = 'space-1';

function link(overrides: Partial<MaterialLink>): MaterialLink {
  return {
    entity_type: 'trial',
    entity_id: 'entity-1',
    display_order: 0,
    ...overrides,
  };
}

describe('routeForLink', () => {
  it('routes a trial link to the trial detail page', () => {
    const route = routeForLink(link({ entity_type: 'trial', entity_id: 't-9' }), TENANT, SPACE);
    expect(route).toEqual({
      commands: ['/t', TENANT, 's', SPACE, 'profiles', 'trials', 't-9'],
    });
  });

  it('routes a company link to the company detail page', () => {
    const route = routeForLink(link({ entity_type: 'company', entity_id: 'c-9' }), TENANT, SPACE);
    expect(route?.commands).toEqual(['/t', TENANT, 's', SPACE, 'profiles', 'companies', 'c-9']);
    expect(route?.queryParams).toBeUndefined();
  });

  it('routes a product link to the asset detail page', () => {
    const route = routeForLink(link({ entity_type: 'product', entity_id: 'a-9' }), TENANT, SPACE);
    expect(route?.commands).toEqual(['/t', TENANT, 's', SPACE, 'profiles', 'assets', 'a-9']);
  });

  it('routes a space link to the engagement root', () => {
    const route = routeForLink(link({ entity_type: 'space', entity_id: 's-9' }), TENANT, SPACE);
    expect(route?.commands).toEqual(['/t', TENANT, 's', SPACE]);
  });

  it('deep-links a marker with a trial assignment to the trial timeline drawer', () => {
    const route = routeForLink(
      link({ entity_type: 'marker', entity_id: 'mk-9', trial_id: 't-7' }),
      TENANT,
      SPACE
    );
    expect(route).toEqual({
      commands: ['/t', TENANT, 's', SPACE, 'profiles', 'trials', 't-7'],
      queryParams: { markerId: 'mk-9' },
    });
  });

  it('leaves a marker with no trial assignment non-clickable', () => {
    expect(
      routeForLink(link({ entity_type: 'marker', entity_id: 'mk-9' }), TENANT, SPACE)
    ).toBeNull();
    expect(
      routeForLink(
        link({ entity_type: 'marker', entity_id: 'mk-9', trial_id: null }),
        TENANT,
        SPACE
      )
    ).toBeNull();
  });

  it('returns null when tenant or space context is missing', () => {
    expect(routeForLink(link({ entity_type: 'trial' }), '', SPACE)).toBeNull();
    expect(routeForLink(link({ entity_type: 'trial' }), TENANT, '')).toBeNull();
  });
});
