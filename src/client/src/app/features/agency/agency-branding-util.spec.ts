import { describe, expect, it } from 'vitest';
import { TEAL_SCALE } from '../../config/primeng-theme';
import {
  SENTINEL_CONTACT_EMAIL,
  displayContactEmail,
  normalizeContactEmailForSave,
  previewBrandScale,
  readableForeground,
} from './agency-branding-util';

describe('displayContactEmail', () => {
  it('blanks the sentinel address', () => {
    expect(displayContactEmail(SENTINEL_CONTACT_EMAIL)).toBe('');
  });

  it('blanks the sentinel even with surrounding whitespace', () => {
    expect(displayContactEmail('  unknown@unknown.invalid  ')).toBe('');
  });

  it('passes through a real email', () => {
    expect(displayContactEmail('owner@acme.com')).toBe('owner@acme.com');
  });

  it('trims a real email', () => {
    expect(displayContactEmail('  owner@acme.com  ')).toBe('owner@acme.com');
  });

  it('returns empty string for null/undefined', () => {
    expect(displayContactEmail(null)).toBe('');
    expect(displayContactEmail(undefined)).toBe('');
  });
});

describe('normalizeContactEmailForSave', () => {
  it('never persists the sentinel', () => {
    expect(normalizeContactEmailForSave(SENTINEL_CONTACT_EMAIL)).toBe('');
  });

  it('blanks an empty/whitespace field', () => {
    expect(normalizeContactEmailForSave('   ')).toBe('');
    expect(normalizeContactEmailForSave('')).toBe('');
  });

  it('trims and keeps a real email', () => {
    expect(normalizeContactEmailForSave('  owner@acme.com ')).toBe('owner@acme.com');
  });
});

describe('previewBrandScale', () => {
  it('generates a scale from a valid hex with hash', () => {
    const scale = previewBrandScale('#0d9488');
    expect(scale[600].toLowerCase()).toBe('#0d9488');
  });

  it('accepts a hex without a leading hash', () => {
    const scale = previewBrandScale('0d9488');
    expect(scale[600].toLowerCase()).toBe('#0d9488');
  });

  it('falls back to teal for an in-progress / malformed hex', () => {
    expect(previewBrandScale('#0d9')).toBe(TEAL_SCALE);
    expect(previewBrandScale('')).toBe(TEAL_SCALE);
    expect(previewBrandScale(null)).toBe(TEAL_SCALE);
    expect(previewBrandScale('not-a-color')).toBe(TEAL_SCALE);
  });

  it('produces a full 11-stop scale', () => {
    const scale = previewBrandScale('#3b82f6');
    expect(Object.keys(scale).map(Number).sort((a, b) => a - b)).toEqual([
      50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950,
    ]);
  });
});

describe('readableForeground', () => {
  it('uses white on a dark brand tint', () => {
    expect(readableForeground('#0d9488', '#042f2e')).toBe('#ffffff');
  });

  it('falls back to the dark stop on a light brand tint', () => {
    expect(readableForeground('#fde047', '#713f12')).toBe('#713f12');
  });
});
