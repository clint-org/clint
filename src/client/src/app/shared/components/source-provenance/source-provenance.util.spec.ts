import { describe, expect, it } from 'vitest';

import { SourceProvenance } from './source-provenance.model';
import {
  formatProvenanceDate,
  formatSourceBody,
  provenanceTitle,
  provenanceTooltip,
  sourceBodyLabel,
  sourceKindLabel,
} from './source-provenance.util';

function makeDoc(overrides: Partial<SourceProvenance> = {}): SourceProvenance {
  return {
    source_doc_id: 'doc-1',
    space_id: 'space-1',
    source_title: 'Pfizer Q2 press release',
    source_kind: 'text',
    source_url: null,
    source_text: 'raw text',
    fetched_at: '2026-06-03T10:00:00Z',
    fetch_outcome: 'paste',
    created_at: '2026-06-03T10:00:00Z',
    imported_by_email: 'jane@pharma.test',
    ai_model: 'claude-sonnet-4-6',
    ai_outcome: 'success',
    ...overrides,
  };
}

describe('provenanceTitle', () => {
  it('returns the source title when present', () => {
    expect(provenanceTitle(makeDoc({ source_title: 'Pfizer Q2 press release' }))).toBe(
      'Pfizer Q2 press release'
    );
  });

  it('falls back to "Untitled source" when the title is null', () => {
    expect(provenanceTitle(makeDoc({ source_title: null }))).toBe('Untitled source');
  });

  it('falls back when the title is blank whitespace', () => {
    expect(provenanceTitle(makeDoc({ source_title: '   ' }))).toBe('Untitled source');
  });

  it('returns "Untitled source" for a null doc', () => {
    expect(provenanceTitle(null)).toBe('Untitled source');
  });
});

describe('provenanceTooltip', () => {
  it('reads "Imported from <title> · <date>"', () => {
    const tip = provenanceTooltip(
      makeDoc({ source_title: 'NCT batch import (1 trials)', created_at: '2026-06-26T12:00:00Z' })
    );
    expect(tip).toBe('Imported from NCT batch import (1 trials) · Jun 26, 2026');
  });

  it('falls back to "Untitled source" when the title is missing', () => {
    const tip = provenanceTooltip(makeDoc({ source_title: null, created_at: '2026-06-03T10:00:00Z' }));
    expect(tip).toBe('Imported from Untitled source · Jun 3, 2026');
  });

  it('returns an empty string for a null doc', () => {
    expect(provenanceTooltip(null)).toBe('');
  });
});

describe('sourceKindLabel', () => {
  it('labels a URL import', () => {
    expect(sourceKindLabel('url')).toBe('Web page');
  });

  it('labels a text-paste import', () => {
    expect(sourceKindLabel('text')).toBe('Pasted text');
  });

  it('labels an NCT batch import', () => {
    expect(sourceKindLabel('nct')).toBe('NCT batch');
  });
});

describe('formatSourceBody', () => {
  it('pretty-prints an NCT JSON body with indentation', () => {
    const compact = '[{"nct_id":"NCT01","phase":"P3"}]';
    const out = formatSourceBody(compact, 'nct');
    expect(out).toContain('\n');
    expect(out).toContain('  "nct_id": "NCT01"');
  });

  it('returns an NCT body unchanged when it is not valid JSON', () => {
    const broken = '{not json';
    expect(formatSourceBody(broken, 'nct')).toBe(broken);
  });

  it('leaves a text paste untouched even when it looks like JSON', () => {
    const pasted = '{"looks":"like json"}';
    expect(formatSourceBody(pasted, 'text')).toBe(pasted);
  });

  it('leaves a fetched URL page untouched', () => {
    const page = 'Pfizer reports topline results...';
    expect(formatSourceBody(page, 'url')).toBe(page);
  });
});

describe('sourceBodyLabel', () => {
  it('calls a text paste the original text the analyst authored', () => {
    expect(sourceBodyLabel('text')).toBe('Original text');
  });

  it('calls a URL import the fetched page', () => {
    expect(sourceBodyLabel('url')).toBe('Fetched page');
  });

  it('calls an NCT import the retrieved study data (it is CT.gov JSON, not authored text)', () => {
    expect(sourceBodyLabel('nct')).toBe('Retrieved study data');
  });
});

describe('formatProvenanceDate', () => {
  it('formats an ISO timestamp as a short UTC date', () => {
    expect(formatProvenanceDate('2026-06-03T10:00:00Z')).toBe('Jun 3, 2026');
  });

  it('uses UTC, not local time, at day boundaries', () => {
    // 23:30Z on the 3rd must stay the 3rd regardless of the runner timezone.
    expect(formatProvenanceDate('2026-06-03T23:30:00Z')).toBe('Jun 3, 2026');
  });
});
