import '@angular/compiler'; // required for JIT in vitest node environment
import { describe, expect, it } from 'vitest';
import { Route } from '@angular/router';
import { routes } from './app.routes';
import { editGuard } from './core/guards/edit.guard';

// Recursively collect every route with its full path joined by '/'.
function flatten(rs: Route[], prefix = ''): { path: string; route: Route }[] {
  const out: { path: string; route: Route }[] = [];
  for (const r of rs) {
    const path = [prefix, r.path ?? ''].filter(Boolean).join('/');
    out.push({ path, route: r });
    if (r.children) out.push(...flatten(r.children, path));
  }
  return out;
}

describe('app.routes profiles rename', () => {
  const all = flatten(routes);
  const find = (suffix: string) => all.find((e) => e.path.endsWith(suffix));

  it('exposes profiles/* entity routes and no manage/* routes', () => {
    expect(find('profiles/companies')).toBeTruthy();
    expect(find('profiles/assets')).toBeTruthy();
    expect(find('profiles/trials')).toBeTruthy();
    expect(find('profiles/engagement')).toBeTruthy();
    expect(all.some((e) => e.path.includes('manage/'))).toBe(false);
  });

  it('removes editGuard from profiles list routes (viewer-browsable)', () => {
    for (const suffix of ['profiles/companies', 'profiles/assets', 'profiles/trials']) {
      const list = find(suffix)!;
      expect(list.route.canActivate ?? [], suffix).not.toContain(editGuard);
    }
  });

  it('reuses editGuard on the taxonomies reference-settings route', () => {
    const tax = find('settings/taxonomies')!;
    expect(tax.route.canActivate ?? []).toContain(editGuard);
  });

  it('adds a space-level taxonomies guide route', () => {
    expect(find('help/taxonomies')).toBeTruthy();
  });
});
