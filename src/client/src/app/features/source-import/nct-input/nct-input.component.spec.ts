import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parseNctIds } from './nct-parse';

describe('NctInputComponent progress template contract', () => {
  const src = readFileSync(join(__dirname, 'nct-input.component.ts'), 'utf8');

  it('signs the progress block with the Clint Intelligence badge, active until done', () => {
    expect(src).toContain('app-intelligence-badge');
    expect(src).toContain(`[active]="phase() !== 'done'"`);
  });

  it('uses the branded loader on the active step instead of a pulsing dot', () => {
    expect(src).toContain('app-loader');
    expect(src).not.toContain('animate-ping');
  });
});

describe('parseNctIds', () => {
  it('extracts valid NCT IDs from newline-separated input', () => {
    const result = parseNctIds('NCT01234567\nNCT02345678\nNCT03456789');
    expect(result.valid).toEqual(['NCT01234567', 'NCT02345678', 'NCT03456789']);
    expect(result.malformed).toEqual([]);
  });

  it('extracts valid NCT IDs from comma-separated input', () => {
    const result = parseNctIds('NCT01234567, NCT02345678, NCT03456789');
    expect(result.valid).toEqual(['NCT01234567', 'NCT02345678', 'NCT03456789']);
    expect(result.malformed).toEqual([]);
  });

  it('handles mixed separators (newlines, commas, spaces, tabs)', () => {
    const result = parseNctIds('NCT01234567,NCT02345678\nNCT03456789\tNCT04567890');
    expect(result.valid).toEqual([
      'NCT01234567',
      'NCT02345678',
      'NCT03456789',
      'NCT04567890',
    ]);
  });

  it('normalizes case to uppercase', () => {
    const result = parseNctIds('nct01234567\nNct02345678');
    expect(result.valid).toEqual(['NCT01234567', 'NCT02345678']);
  });

  it('deduplicates NCT IDs', () => {
    const result = parseNctIds('NCT01234567\nNCT01234567\nnct01234567');
    expect(result.valid).toEqual(['NCT01234567']);
    expect(result.malformed).toEqual([]);
  });

  it('flags malformed entries with too few digits', () => {
    const result = parseNctIds('NCT0123456\nNCT01234567');
    expect(result.valid).toEqual(['NCT01234567']);
    expect(result.malformed).toEqual(['NCT0123456']);
  });

  it('flags malformed entries with too few digits (5)', () => {
    const result = parseNctIds('NCT12345');
    expect(result.valid).toEqual([]);
    expect(result.malformed).toEqual(['NCT12345']);
  });

  it('returns empty arrays for empty input', () => {
    const result = parseNctIds('');
    expect(result.valid).toEqual([]);
    expect(result.malformed).toEqual([]);
  });

  it('returns empty arrays for whitespace-only input', () => {
    const result = parseNctIds('   \n\n  ');
    expect(result.valid).toEqual([]);
    expect(result.malformed).toEqual([]);
  });

  it('extracts NCT IDs embedded in prose', () => {
    const result = parseNctIds('Study NCT01234567 was combined with NCT02345678.');
    expect(result.valid).toEqual(['NCT01234567', 'NCT02345678']);
    expect(result.malformed).toEqual([]);
  });

  it('ignores random text without NCT prefix', () => {
    const result = parseNctIds('hello world 12345678');
    expect(result.valid).toEqual([]);
    expect(result.malformed).toEqual([]);
  });

  it('handles a single valid NCT ID', () => {
    const result = parseNctIds('NCT01234567');
    expect(result.valid).toEqual(['NCT01234567']);
    expect(result.malformed).toEqual([]);
  });

  it('deduplicates malformed entries', () => {
    const result = parseNctIds('NCT123\nNCT123');
    expect(result.malformed).toEqual(['NCT123']);
  });

  it('does not flag valid NCTs as malformed', () => {
    const result = parseNctIds('NCT01234567 NCT02345678');
    expect(result.valid).toEqual(['NCT01234567', 'NCT02345678']);
    expect(result.malformed).toEqual([]);
  });

  it('handles 50+ NCT IDs (no client-side limit on parse)', () => {
    const ids = Array.from({ length: 55 }, (_, i) =>
      `NCT${String(i).padStart(8, '0')}`
    ).join('\n');
    const result = parseNctIds(ids);
    expect(result.valid).toHaveLength(55);
    expect(result.malformed).toEqual([]);
  });
});
