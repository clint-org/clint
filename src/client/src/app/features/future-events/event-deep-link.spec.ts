import { describe, expect, it } from 'vitest';
import { resolveDeepLinkEventId } from './event-deep-link';

/** Minimal ParamMap stand-in: a plain map with the `get(name)` accessor. */
function paramMap(entries: Record<string, string>): { get(name: string): string | null } {
  return { get: (name: string) => entries[name] ?? null };
}

describe('resolveDeepLinkEventId', () => {
  it('returns the eventId param when present', () => {
    expect(resolveDeepLinkEventId(paramMap({ eventId: 'evt-1' }))).toBe('evt-1');
  });

  it('falls back to the legacy markerId param', () => {
    expect(resolveDeepLinkEventId(paramMap({ markerId: 'mk-9' }))).toBe('mk-9');
  });

  it('prefers eventId over markerId when both are present', () => {
    expect(resolveDeepLinkEventId(paramMap({ eventId: 'evt-1', markerId: 'mk-9' }))).toBe('evt-1');
  });

  it('returns null when neither param is present', () => {
    expect(resolveDeepLinkEventId(paramMap({}))).toBeNull();
  });
});
