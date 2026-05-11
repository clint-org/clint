import { test, expect } from '@playwright/test';
import { buildEntityRouterLink } from './intelligence-router-link';

const T = 'tenant-1';
const S = 'space-1';

test.describe('buildEntityRouterLink', () => {
  test('routes a trial to the trial detail page', () => {
    expect(buildEntityRouterLink(T, S, 'trial', 'trial-1')).toEqual([
      '/t',
      T,
      's',
      S,
      'manage',
      'trials',
      'trial-1',
    ]);
  });

  test('routes a company to the company detail page', () => {
    expect(buildEntityRouterLink(T, S, 'company', 'co-1')).toEqual([
      '/t',
      T,
      's',
      S,
      'manage',
      'companies',
      'co-1',
    ]);
  });

  test('routes a product (asset) to the asset detail page', () => {
    expect(buildEntityRouterLink(T, S, 'product', 'prod-1')).toEqual([
      '/t',
      T,
      's',
      S,
      'manage',
      'assets',
      'prod-1',
    ]);
  });

  test('routes a marker to the marker detail page', () => {
    expect(buildEntityRouterLink(T, S, 'marker', 'm-1')).toEqual([
      '/t',
      T,
      's',
      S,
      'manage',
      'markers',
      'm-1',
    ]);
  });

  test('routes a space (engagement) to the engagement page (no id segment)', () => {
    expect(buildEntityRouterLink(T, S, 'space', 'ignored')).toEqual([
      '/t',
      T,
      's',
      S,
      'manage',
      'engagement',
    ]);
  });

  test('returns null when tenant or space is missing', () => {
    expect(buildEntityRouterLink(null, S, 'trial', 'x')).toBeNull();
    expect(buildEntityRouterLink(T, null, 'trial', 'x')).toBeNull();
    expect(buildEntityRouterLink('', S, 'trial', 'x')).toBeNull();
  });
});
