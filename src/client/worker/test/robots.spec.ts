import { describe, it, expect } from 'vitest';
import { buildRobots } from '../robots';

const APEX = ['clintapp.com'];

describe('buildRobots', () => {
  it('lets crawlers see the apex marketing site but blocks app paths', () => {
    const out = buildRobots('clintapp.com', APEX);
    expect(out).toContain('User-agent: *');
    expect(out).toContain('Disallow: /login');
    expect(out).toContain('Disallow: /admin');
    expect(out).toContain('Disallow: /super-admin');
  });

  it('blocks everything on a tenant subdomain', () => {
    const out = buildRobots('pfizer.clintapp.com', APEX);
    expect(out).toContain('Disallow: /');
    expect(out).not.toContain('Disallow: /login');
  });

  it('matches the apex case-insensitively', () => {
    expect(buildRobots('CLINTAPP.COM', APEX)).toContain('Disallow: /login');
  });
});
