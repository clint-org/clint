import { describe, it, expect } from 'vitest';
import { walkCtgovPath, formatCtgovFieldValue, lookupCtgovField } from './ctgov-field-format';

// Sample CT.gov v2 payload shaped to exercise every field kind in the
// catalogue. Real shape pulled from clinicaltrials.gov/api/v2/studies/<NCT>.
const PAYLOAD = {
  protocolSection: {
    identificationModule: {
      nctId: 'NCT04832594',
      briefTitle: 'A Study of Something',
      acronym: 'TESTACRONYM',
    },
    statusModule: {
      overallStatus: 'RECRUITING',
      lastUpdatePostDateStruct: { date: '2024-06-15' },
      whyStopped: 'multi\nline\nreason',
      startDateStruct: { date: '2021-04-05' },
    },
    designModule: {
      phases: ['PHASE2', 'PHASE3'],
      enrollmentInfo: { count: 250, type: 'ESTIMATED' },
    },
    armsInterventionsModule: {
      armGroups: [{ label: 'Active arm' }, { label: 'Placebo arm' }],
      interventions: [{ name: 'Drug A' }, { name: 'Drug B' }, { name: 'Sham' }],
    },
    conditionsModule: {
      conditions: ['Breast Cancer', 'Lung Cancer'],
      keywords: ['oncology', 'phase-3'],
    },
    oversightModule: { isUsExport: true },
  },
};

describe('walkCtgovPath', () => {
  it('returns the leaf value for a deep dotted path', () => {
    expect(walkCtgovPath(PAYLOAD, 'protocolSection.identificationModule.nctId')).toBe(
      'NCT04832594'
    );
  });

  it('returns the inner object for a partial path', () => {
    expect(walkCtgovPath(PAYLOAD, 'protocolSection.identificationModule')).toEqual({
      nctId: 'NCT04832594',
      briefTitle: 'A Study of Something',
      acronym: 'TESTACRONYM',
    });
  });

  it('returns undefined when an intermediate key is missing', () => {
    expect(walkCtgovPath(PAYLOAD, 'protocolSection.missingModule.nctId')).toBeUndefined();
  });

  it('returns undefined when the leaf key is missing', () => {
    expect(
      walkCtgovPath(PAYLOAD, 'protocolSection.identificationModule.officialTitle')
    ).toBeUndefined();
  });

  it('returns undefined when traversing through an array (treats arrays as opaque)', () => {
    // armGroups is an array; descending into a key on the array itself is not
    // a valid object-walk operation. Returning undefined keeps the renderer
    // from showing garbage like `0` or the array's `length`.
    expect(
      walkCtgovPath(PAYLOAD, 'protocolSection.armsInterventionsModule.armGroups.label')
    ).toBeUndefined();
  });

  it('returns undefined when traversing through a primitive', () => {
    expect(
      walkCtgovPath(PAYLOAD, 'protocolSection.identificationModule.nctId.length')
    ).toBeUndefined();
  });

  it('returns the input unchanged for an empty path component sequence', () => {
    // Edge case: split('.') on '' yields [''] which then lookups the empty key
    // -> undefined. Documenting current behavior, not endorsing the spelling.
    expect(walkCtgovPath(PAYLOAD, '')).toBeUndefined();
  });

  it('returns undefined for null / undefined / non-object snapshot', () => {
    expect(walkCtgovPath(null, 'protocolSection.identificationModule.nctId')).toBeUndefined();
    expect(walkCtgovPath(undefined, 'protocolSection.identificationModule.nctId')).toBeUndefined();
    expect(walkCtgovPath('a string', 'foo')).toBeUndefined();
    expect(walkCtgovPath(42, 'foo')).toBeUndefined();
  });
});

describe('lookupCtgovField', () => {
  it('returns the catalogue entry for a known path', () => {
    const f = lookupCtgovField('protocolSection.identificationModule.nctId');
    expect(f).toBeDefined();
    expect(f?.label).toBe('NCT identifier');
    expect(f?.kind).toBe('string');
  });

  it('returns undefined for an unknown path', () => {
    expect(lookupCtgovField('protocolSection.someBogusModule.field')).toBeUndefined();
  });
});

describe('formatCtgovFieldValue', () => {
  // ---- string ----
  it('renders a string field directly', () => {
    expect(formatCtgovFieldValue(PAYLOAD, 'protocolSection.identificationModule.nctId')).toBe(
      'NCT04832594'
    );
  });

  // ---- longtext ----
  it('renders a longtext field with newlines preserved as-is', () => {
    expect(formatCtgovFieldValue(PAYLOAD, 'protocolSection.statusModule.whyStopped')).toBe(
      'multi\nline\nreason'
    );
  });

  // ---- number ----
  it('renders a number field as a string', () => {
    expect(
      formatCtgovFieldValue(PAYLOAD, 'protocolSection.designModule.enrollmentInfo.count')
    ).toBe('250');
  });

  it('returns empty string for a number field whose value is non-numeric', () => {
    const bad = {
      protocolSection: { designModule: { enrollmentInfo: { count: 'oops' } } },
    };
    expect(formatCtgovFieldValue(bad, 'protocolSection.designModule.enrollmentInfo.count')).toBe(
      ''
    );
  });

  // ---- boolean ----
  it('renders boolean true as "Yes"', () => {
    expect(formatCtgovFieldValue(PAYLOAD, 'protocolSection.oversightModule.isUsExport')).toBe(
      'Yes'
    );
  });

  it('renders boolean false as "No"', () => {
    const p = { protocolSection: { oversightModule: { isUsExport: false } } };
    expect(formatCtgovFieldValue(p, 'protocolSection.oversightModule.isUsExport')).toBe('No');
  });

  it('returns empty string for a boolean field whose value is not a boolean', () => {
    const p = { protocolSection: { oversightModule: { isUsExport: 'yes' } } };
    expect(formatCtgovFieldValue(p, 'protocolSection.oversightModule.isUsExport')).toBe('');
  });

  // ---- date ----
  it('renders a date field as ISO YYYY-MM-DD', () => {
    expect(
      formatCtgovFieldValue(PAYLOAD, 'protocolSection.statusModule.startDateStruct.date')
    ).toBe('2021-04-05');
  });

  it('returns empty string for an unparseable date string', () => {
    const p = { protocolSection: { statusModule: { startDateStruct: { date: 'not-a-date' } } } };
    expect(formatCtgovFieldValue(p, 'protocolSection.statusModule.startDateStruct.date')).toBe('');
  });

  // ---- array ----
  it('renders summary=count array fields as "N items"', () => {
    // `conditions` is catalogued with summary: 'count' so the inline / cell
    // formatter shows the count instead of the joined values. The renderer
    // component uses the same convention for the collapsed state.
    expect(formatCtgovFieldValue(PAYLOAD, 'protocolSection.conditionsModule.conditions')).toBe(
      '2 items'
    );
  });

  it('renders array of objects via the catalogue itemPath', () => {
    expect(
      formatCtgovFieldValue(PAYLOAD, 'protocolSection.armsInterventionsModule.interventions')
    ).toBe('Drug A, Drug B, Sham');
  });

  it('falls back to empty string entries when itemPath misses on some elements', () => {
    const p = {
      protocolSection: {
        armsInterventionsModule: {
          interventions: [{ name: 'Drug A' }, { foo: 'bar' }, { name: 'Drug C' }],
        },
      },
    };
    // The middle element's `name` is undefined and gets filtered before join.
    expect(formatCtgovFieldValue(p, 'protocolSection.armsInterventionsModule.interventions')).toBe(
      'Drug A, Drug C'
    );
  });

  it('handles array kind on a phase-array field (raw primitives, no itemPath)', () => {
    expect(formatCtgovFieldValue(PAYLOAD, 'protocolSection.designModule.phases')).toBe(
      'PHASE2, PHASE3'
    );
  });

  it('returns empty string when an array field is not actually an array', () => {
    const p = { protocolSection: { conditionsModule: { conditions: 'just one' } } };
    expect(formatCtgovFieldValue(p, 'protocolSection.conditionsModule.conditions')).toBe('');
  });

  // ---- null / missing handling ----
  it('returns empty string for a present-but-null value', () => {
    const p = { protocolSection: { identificationModule: { nctId: null } } };
    expect(formatCtgovFieldValue(p, 'protocolSection.identificationModule.nctId')).toBe('');
  });

  it('returns empty string for an entirely missing path', () => {
    expect(formatCtgovFieldValue({}, 'protocolSection.identificationModule.nctId')).toBe('');
  });

  it('returns empty string for an unknown catalogue path', () => {
    // Caller supplied a path the catalogue has no entry for. Returning empty
    // protects the table cell from rendering "[object Object]" or similar.
    expect(formatCtgovFieldValue(PAYLOAD, 'protocolSection.someBogusModule.field')).toBe('');
  });
});
