import { test, expect } from '@playwright/test';
import {
  summarizeVersionChange,
  type VersionShape,
} from './version-summary';

const base: VersionShape = {
  headline: 'Same',
  thesis_md: 'thesis',
  watch_md: 'watch',
  implications_md: 'implications',
};

test.describe('summarizeVersionChange', () => {
  test('marks first publish when there is no prior', () => {
    expect(summarizeVersionChange(base, null)).toEqual({
      changedSections: [],
      isFirst: true,
    });
  });

  test('reports zero changes when fields match', () => {
    expect(summarizeVersionChange(base, { ...base })).toEqual({
      changedSections: [],
      isFirst: false,
    });
  });

  test('reports headline-only change', () => {
    expect(
      summarizeVersionChange({ ...base, headline: 'New' }, base)
    ).toEqual({ changedSections: ['headline'], isFirst: false });
  });

  test('reports multiple changed sections in canonical order', () => {
    expect(
      summarizeVersionChange(
        { ...base, watch_md: 'changed', thesis_md: 'changed' },
        base
      )
    ).toEqual({
      changedSections: ['thesis', 'watch'],
      isFirst: false,
    });
  });

  test('reports implications change', () => {
    expect(
      summarizeVersionChange(
        { ...base, implications_md: 'new' },
        base
      )
    ).toEqual({ changedSections: ['implications'], isFirst: false });
  });
});
