import { describe, it, expect } from 'vitest';
import {
  PRIVACY_SECTIONS,
  TERMS_SECTIONS,
  PLATFORM_OPERATOR,
  PLATFORM_LEGAL_EMAIL,
  PLATFORM_SUPPORT_EMAIL,
} from './legal-content';

const allText = [...PRIVACY_SECTIONS, ...TERMS_SECTIONS]
  .flatMap((s) => [s.heading, ...s.body])
  .join(' ');

describe('legal content', () => {
  it('attributes the documents to the platform operator', () => {
    expect(PLATFORM_OPERATOR).toBe('Clint');
    expect(allText).toContain('Clint');
  });

  it('exposes the platform legal contact email', () => {
    expect(PLATFORM_LEGAL_EMAIL).toBe('privacy@clintapp.com');
    expect(allText).toContain('privacy@clintapp.com');
  });

  it('exposes a distinct general support email (not the legal mailbox)', () => {
    expect(PLATFORM_SUPPORT_EMAIL).toBe('support@clintapp.com');
    expect(PLATFORM_SUPPORT_EMAIL).not.toBe(PLATFORM_LEGAL_EMAIL);
  });

  it('is platform-owned, not brand-swapped to a tenant name', () => {
    expect(allText.toLowerCase()).not.toContain('acme');
  });

  it('has non-empty privacy and terms sections', () => {
    expect(PRIVACY_SECTIONS.length).toBeGreaterThan(0);
    expect(TERMS_SECTIONS.length).toBeGreaterThan(0);
  });
});
