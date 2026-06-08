import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createCookieStorage, type CookieStorageOptions } from './cookie-session-storage';

/**
 * Domain-aware `document.cookie` mock.
 *
 * Real browsers key cookies by (name, domain), expose only `name=value` pairs
 * via `document.cookie`, and only delete a cookie when the Set-Cookie's `Domain`
 * matches the domain it was written with. That last property is the crux of the
 * bug under test: a delete scoped to a child domain (`.dev.clintapp.com`) cannot
 * remove a cookie stored at a parent domain (`.clintapp.com`).
 *
 * Cookies seeded here are always ancestors of the simulated host, so "expose all
 * entries" faithfully models what a child subdomain would receive.
 */
interface JarEntry {
  name: string;
  value: string;
  domain: string | null;
}

function installCookieJar(): { jar: JarEntry[] } {
  const jar: JarEntry[] = [];
  const doc = {
    get cookie(): string {
      return jar.map((e) => `${e.name}=${e.value}`).join('; ');
    },
    set cookie(str: string) {
      const [pair, ...attrs] = str.split(';').map((p) => p.trim());
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      let domain: string | null = null;
      let maxAge: string | null = null;
      for (const a of attrs) {
        const [k, v] = a.split('=');
        if (k.toLowerCase() === 'domain') domain = v ?? null;
        if (k.toLowerCase() === 'max-age') maxAge = v ?? null;
      }
      const idx = jar.findIndex((e) => e.name === name && e.domain === domain);
      if (maxAge === '0') {
        if (idx >= 0) jar.splice(idx, 1);
        return;
      }
      if (idx >= 0) jar[idx] = { name, value, domain };
      else jar.push({ name, value, domain });
    },
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  return { jar };
}

const baseOpts: Omit<CookieStorageOptions, 'domain'> = {
  secure: false,
  sameSite: 'lax',
  path: '/',
  maxAgeSeconds: 3600,
};

function adapterFor(domain: string) {
  return createCookieStorage({ ...baseOpts, domain });
}

describe('createCookieStorage', () => {
  let jar: JarEntry[];

  beforeEach(() => {
    jar = installCookieJar().jar;
  });

  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it('round-trips a value written at the configured domain', () => {
    const dev = adapterFor('.dev.clintapp.com');
    dev.setItem('sb-auth-dev', 'TOKEN');
    expect(dev.getItem('sb-auth-dev')).toBe('TOKEN');
    dev.removeItem('sb-auth-dev');
    expect(dev.getItem('sb-auth-dev')).toBeNull();
  });

  it('removeItem clears a cookie written at a parent domain', () => {
    // A production client wrote sb-auth scoped to the apex; it leaks down to the
    // dev subdomain, which reads it but (before the fix) cannot delete it.
    const prod = adapterFor('.clintapp.com');
    prod.setItem('sb-auth', 'PRODTOKEN');

    const dev = adapterFor('.dev.clintapp.com');
    expect(dev.getItem('sb-auth')).toBe('PRODTOKEN');

    dev.removeItem('sb-auth');

    expect(dev.getItem('sb-auth')).toBeNull();
    expect(jar).toHaveLength(0);
  });

  it('removeItem clears a chunked cookie written at a parent domain', () => {
    const prod = adapterFor('.clintapp.com');
    const big = 'A'.repeat(7000); // 3 chunks at CHUNK_SIZE 3000
    prod.setItem('sb-auth', big);

    const dev = adapterFor('.dev.clintapp.com');
    expect(dev.getItem('sb-auth')).toBe(big);
    // head + 3 chunks present at the parent domain
    expect(jar.length).toBe(4);

    dev.removeItem('sb-auth');

    expect(dev.getItem('sb-auth')).toBeNull();
    expect(jar).toHaveLength(0);
  });
});
