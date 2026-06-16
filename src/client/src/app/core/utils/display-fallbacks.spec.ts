import { describe, expect, it } from 'vitest';
import {
  resolveSpaceBadge,
  resolveTherapeuticAreaLabel,
  resolveUserDisplay,
  shouldShowTrialSecondaryName,
} from './display-fallbacks';

describe('resolveUserDisplay', () => {
  it('returns "(unknown user)" for null', () => {
    expect(resolveUserDisplay(null)).toBe('(unknown user)');
  });

  it('returns "(unknown user)" for undefined', () => {
    expect(resolveUserDisplay(undefined)).toBe('(unknown user)');
  });

  it('returns "(unknown user)" for a missing reference', () => {
    expect(resolveUserDisplay({ kind: 'missing' })).toBe('(unknown user)');
  });

  it('returns "(redacted user)" for a redacted reference', () => {
    expect(resolveUserDisplay({ kind: 'redacted' })).toBe('(redacted user)');
  });

  it('prefers displayName when present', () => {
    expect(
      resolveUserDisplay({ kind: 'present', displayName: 'Ada Lovelace', email: 'ada@example.com' }),
    ).toBe('Ada Lovelace');
  });

  it('falls back to email when displayName is missing', () => {
    expect(resolveUserDisplay({ kind: 'present', email: 'ada@example.com' })).toBe(
      'ada@example.com',
    );
  });

  it('falls back to email when displayName is an empty string', () => {
    expect(
      resolveUserDisplay({ kind: 'present', displayName: '   ', email: 'ada@example.com' }),
    ).toBe('ada@example.com');
  });

  it('returns "(unknown user)" when present with neither name nor email', () => {
    expect(resolveUserDisplay({ kind: 'present' })).toBe('(unknown user)');
  });

  it('returns "(unknown user)" when present with empty strings for both fields', () => {
    expect(resolveUserDisplay({ kind: 'present', displayName: '', email: '   ' })).toBe(
      '(unknown user)',
    );
  });
});

describe('resolveTherapeuticAreaLabel', () => {
  it('returns "(uncategorized)" for null', () => {
    expect(resolveTherapeuticAreaLabel(null)).toBe('(uncategorized)');
  });

  it('returns "(uncategorized)" for undefined', () => {
    expect(resolveTherapeuticAreaLabel(undefined)).toBe('(uncategorized)');
  });

  it('returns the name when present', () => {
    expect(resolveTherapeuticAreaLabel({ name: 'Oncology', abbreviation: 'ONC' })).toBe('Oncology');
  });

  it('falls back to the abbreviation when name is empty', () => {
    expect(resolveTherapeuticAreaLabel({ name: '', abbreviation: 'ONC' })).toBe('ONC');
  });

  it('falls back to the abbreviation when name is whitespace', () => {
    expect(resolveTherapeuticAreaLabel({ name: '   ', abbreviation: 'ONC' })).toBe('ONC');
  });

  it('returns "(uncategorized)" when both name and abbreviation are empty', () => {
    expect(resolveTherapeuticAreaLabel({ name: '', abbreviation: '' })).toBe('(uncategorized)');
  });

  it('returns "(uncategorized)" when name is null and abbreviation is omitted', () => {
    expect(resolveTherapeuticAreaLabel({ name: null })).toBe('(uncategorized)');
  });
});

describe('resolveSpaceBadge', () => {
  it('returns null for null', () => {
    expect(resolveSpaceBadge(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(resolveSpaceBadge(undefined)).toBeNull();
  });

  it('returns null when archivedAt is null', () => {
    expect(resolveSpaceBadge({ archivedAt: null })).toBeNull();
  });

  it('returns null when archivedAt is omitted (active space)', () => {
    expect(resolveSpaceBadge({})).toBeNull();
  });

  it('returns an archived badge when archivedAt is an ISO string', () => {
    expect(resolveSpaceBadge({ archivedAt: '2026-05-20T12:00:00Z' })).toEqual({
      label: '(archived)',
      tone: 'archived',
    });
  });

  it('returns an archived badge when archivedAt is a Date instance', () => {
    expect(resolveSpaceBadge({ archivedAt: new Date('2026-05-20T12:00:00Z') })).toEqual({
      label: '(archived)',
      tone: 'archived',
    });
  });
});

describe('shouldShowTrialSecondaryName', () => {
  it('suppresses the secondary line when acronym equals name (UI-23)', () => {
    expect(shouldShowTrialSecondaryName('ATTAIN-1', 'ATTAIN-1', 'NCT12345678')).toBe(false);
  });

  it('shows the secondary line when name differs from both acronym and identifier', () => {
    expect(
      shouldShowTrialSecondaryName('ATTAIN-1', 'A Study of Tirzepatide', 'NCT12345678'),
    ).toBe(true);
  });

  it('suppresses when name equals the identifier', () => {
    expect(shouldShowTrialSecondaryName('ATTAIN-1', 'NCT12345678', 'NCT12345678')).toBe(false);
  });

  it('returns false when there is no acronym', () => {
    expect(shouldShowTrialSecondaryName(null, 'Some Name', 'NCT12345678')).toBe(false);
  });

  it('returns false when the name is empty or whitespace', () => {
    expect(shouldShowTrialSecondaryName('ATTAIN-1', '   ', 'NCT12345678')).toBe(false);
    expect(shouldShowTrialSecondaryName('ATTAIN-1', null, 'NCT12345678')).toBe(false);
  });

  it('ignores surrounding whitespace when comparing', () => {
    expect(shouldShowTrialSecondaryName('ATTAIN-1', '  ATTAIN-1 ', 'NCT12345678')).toBe(false);
  });

  it('tolerates a null identifier', () => {
    expect(shouldShowTrialSecondaryName('ATTAIN-1', 'A Study of Tirzepatide', null)).toBe(true);
  });
});
