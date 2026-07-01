import { describe, expect, it } from 'vitest';
import { importWarningLabel } from './review-warnings.logic';

describe('importWarningLabel', () => {
  it('labels a chunked-batch failure with a re-import hint (#178)', () => {
    const label = importWarningLabel('nct_chunk_failed:LLM call aborted: exceeded the 90000ms timeout');
    expect(label).toContain('some trials were skipped');
    expect(label).toContain('Re-import');
    expect(label).not.toContain('nct_chunk_failed');
  });

  it('labels a partial CT.gov enrichment failure by prefix', () => {
    const label = importWarningLabel('ctgov_partial:trial_3');
    expect(label).toContain('ClinicalTrials.gov');
    expect(label).not.toContain('ctgov_partial');
  });

  it('maps a known exact code', () => {
    expect(importWarningLabel('empty_extraction')).toContain('No companies, assets, or trials');
  });

  it('returns an unknown code verbatim rather than blank', () => {
    expect(importWarningLabel('some_new_code')).toBe('some_new_code');
  });
});
