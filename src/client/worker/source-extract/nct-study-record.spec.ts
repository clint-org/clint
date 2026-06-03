import { describe, it, expect } from 'vitest';
import { toStudyRecord } from './nct-study-record';

// Shaped after the real ClinicalTrials.gov v2 payload for NCT05567796
// (REDEFINE 1). The combination product "CagriSema" appears only as an arm
// label; at the intervention level CT.gov lists the two molecules separately.
const redefine1 = {
  protocolSection: {
    identificationModule: {
      nctId: 'NCT05567796',
      briefTitle:
        'Efficacy and Safety of Cagrilintide s.c. 2.4 mg in Combination With Semaglutide',
      acronym: 'REDEFINE 1',
    },
    statusModule: {
      overallStatus: 'COMPLETED',
      startDateStruct: { date: '2022-10-21' },
      primaryCompletionDateStruct: { date: '2024-07-31' },
    },
    designModule: {
      studyType: 'INTERVENTIONAL',
      phases: ['PHASE3'],
      enrollmentInfo: { count: 3417 },
    },
    sponsorCollaboratorsModule: {
      leadSponsor: { name: 'Novo Nordisk A/S' },
      collaborators: [],
    },
    armsInterventionsModule: {
      interventions: [
        { name: 'Cagrilintide', type: 'DRUG', description: 'Cagrilintide s.c.', otherNames: [] },
        { name: 'Semaglutide', type: 'DRUG', description: 'Semaglutide s.c.', otherNames: [] },
        { name: 'Placebo cagrilintide', type: 'DRUG', description: 'Placebo', otherNames: [] },
        { name: 'Placebo semaglutide', type: 'DRUG', description: 'Placebo', otherNames: [] },
      ],
      armGroups: [
        {
          label: 'Cagrisema',
          type: 'EXPERIMENTAL',
          interventionNames: ['Drug: Cagrilintide', 'Drug: Semaglutide'],
        },
        {
          label: 'Cagrilintide',
          type: 'ACTIVE_COMPARATOR',
          interventionNames: ['Drug: Cagrilintide', 'Drug: Placebo semaglutide'],
        },
        {
          label: 'Semaglutide',
          type: 'ACTIVE_COMPARATOR',
          interventionNames: ['Drug: Semaglutide', 'Drug: Placebo cagrilintide'],
        },
        {
          label: 'Placebo s.c.',
          type: 'PLACEBO_COMPARATOR',
          interventionNames: ['Drug: Placebo cagrilintide', 'Drug: Placebo semaglutide'],
        },
      ],
    },
    conditionsModule: { conditions: ['Obesity', 'Overweight'] },
  },
};

describe('toStudyRecord arm-group parsing', () => {
  it('captures the CagriSema combination arm with its two active components', () => {
    const record = toStudyRecord(redefine1);

    expect(record.arm_groups).toHaveLength(4);

    const cagrisema = record.arm_groups.find((a) => a.label === 'Cagrisema');
    expect(cagrisema).toBeDefined();
    expect(cagrisema?.type).toBe('EXPERIMENTAL');
    // Prefix stripped so arm names line up with interventions[].name.
    expect(cagrisema?.intervention_names).toEqual(['Cagrilintide', 'Semaglutide']);
  });

  it('strips the CT.gov type prefix from arm intervention names', () => {
    const record = toStudyRecord(redefine1);
    const allNames = record.arm_groups.flatMap((a) => a.intervention_names);
    expect(allNames.every((n) => !n.includes(':'))).toBe(true);
  });

  it('keeps monotherapy arms as a single active drug plus its matching placebo', () => {
    const record = toStudyRecord(redefine1);
    const mono = record.arm_groups.find((a) => a.label === 'Cagrilintide');
    expect(mono?.intervention_names).toEqual(['Cagrilintide', 'Placebo semaglutide']);
  });

  it('still parses the existing intervention and trial fields (regression)', () => {
    const record = toStudyRecord(redefine1);
    expect(record.nct_id).toBe('NCT05567796');
    expect(record.acronym).toBe('REDEFINE 1');
    expect(record.phase).toBe('P3');
    expect(record.lead_sponsor).toBe('Novo Nordisk A/S');
    expect(record.interventions.map((i) => i.name)).toContain('Cagrilintide');
    expect(record.interventions.map((i) => i.name)).toContain('Semaglutide');
  });

  it('returns an empty arm_groups array when CT.gov omits armGroups', () => {
    const noArms = {
      protocolSection: {
        identificationModule: { nctId: 'NCT00000000', briefTitle: 'x' },
        armsInterventionsModule: {
          interventions: [{ name: 'Drug A', type: 'DRUG' }],
        },
      },
    };
    const record = toStudyRecord(noArms);
    expect(record.arm_groups).toEqual([]);
  });
});
