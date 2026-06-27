import { describe, expect, it } from 'vitest';
import { classify, levenshtein, normalize, type TaxonomyOption } from './taxonomy-match';

function opts(...names: string[]): TaxonomyOption[] {
  return names.map((name, i) => ({ id: `id-${i}`, name }));
}

describe('normalize', () => {
  it('lowercases and trims', () => {
    expect(normalize('  GLP-1  ')).toBe('glp1');
  });

  it('removes internal whitespace so hyphen/space/joined variants converge', () => {
    expect(normalize('GLP-1   receptor   agonist')).toBe('glp1receptoragonist');
    expect(normalize('glp 1 receptor agonist')).toBe('glp1receptoragonist');
  });

  it('strips punctuation and hyphens', () => {
    expect(normalize('GLP-1/GIP (dual)')).toBe('glp1gipdual');
  });

  it('normalizes whitespace/punctuation-only input to empty', () => {
    expect(normalize('   ')).toBe('');
    expect(normalize(' - / . ')).toBe('');
  });
});

describe('levenshtein', () => {
  it('is zero for identical strings', () => {
    expect(levenshtein('receptor', 'receptor')).toBe(0);
  });

  it('counts a single insertion', () => {
    expect(levenshtein('recetor', 'receptor')).toBe(1);
  });

  it('counts a single deletion', () => {
    expect(levenshtein('receptor', 'recetor')).toBe(1);
  });

  it('counts a single substitution', () => {
    expect(levenshtein('cat', 'cot')).toBe(1);
  });
});

describe('classify', () => {
  it('returns exact when normalized text equals an option (case/space/hyphen agnostic)', () => {
    const result = classify('  glp-1   receptor  agonist ', opts('GLP-1 receptor agonist'));
    expect(result.kind).toBe('exact');
  });

  it('treats hyphen-vs-space variants as exact', () => {
    expect(classify('glp 1 receptor agonist', opts('GLP-1 receptor agonist')).kind).toBe('exact');
  });

  it('returns near when the query is a substring of an option', () => {
    const result = classify('GLP-1', opts('GLP-1 receptor agonist'));
    expect(result.kind).toBe('near');
    expect(result.near.map((o) => o.name)).toEqual(['GLP-1 receptor agonist']);
  });

  it('returns near when an option is a substring of the query', () => {
    const result = classify('GLP-1 receptor agonist extended', opts('GLP-1 receptor'));
    expect(result.kind).toBe('near');
    expect(result.near.map((o) => o.name)).toEqual(['GLP-1 receptor']);
  });

  it('returns near for a typo just inside the distance threshold', () => {
    // 8-char query -> threshold 2; one substitution away.
    const result = classify('aaaaaaaa', opts('aaaaaabb'));
    expect(result.kind).toBe('near');
  });

  it('returns none for a difference just outside the distance threshold', () => {
    // 8-char query -> threshold 2; three substitutions away and not a substring.
    expect(classify('aaaaaaaa', opts('aaaaabbb')).kind).toBe('none');
  });

  it('returns none when nothing is close', () => {
    expect(classify('cat', opts('dog', 'elephant')).kind).toBe('none');
  });

  it('returns none for empty or whitespace-only text', () => {
    expect(classify('', opts('GLP-1 receptor agonist')).kind).toBe('none');
    expect(classify('   ', opts('GLP-1 receptor agonist')).kind).toBe('none');
  });

  it('does not surface a near match for a single-character query', () => {
    // Too short to be a meaningful suggestion; avoids noise.
    expect(classify('a', opts('aspirin', 'atorvastatin')).kind).toBe('none');
  });

  it('caps the near list at two, ordered by closeness', () => {
    const result = classify(
      'receptor',
      opts('receptora', 'receptorab', 'receptorabc', 'unrelated')
    );
    expect(result.kind).toBe('near');
    expect(result.near.map((o) => o.name)).toEqual(['receptora', 'receptorab']);
  });
});
