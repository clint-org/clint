import { describe, it, expect } from 'vitest';
import { toStudyRecord, trialDisplayName, applyNctTrialNames } from './nct-study-record';

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

describe('trialDisplayName (acronym-preferring trial name)', () => {
  it('uses the acronym when present', () => {
    expect(
      trialDisplayName({ acronym: 'SYNERGY-Outcomes', brief_title: 'A Master Protocol of Multiple Agents' })
    ).toBe('SYNERGY-Outcomes');
  });
  it('falls back to the brief title when the acronym is null', () => {
    expect(trialDisplayName({ acronym: null, brief_title: 'A Master Protocol of Multiple Agents' })).toBe(
      'A Master Protocol of Multiple Agents'
    );
  });
  it('falls back to the brief title when the acronym is blank/whitespace', () => {
    expect(trialDisplayName({ acronym: '   ', brief_title: 'Fallback Title' })).toBe('Fallback Title');
  });
});

describe('applyNctTrialNames (deterministic naming over the LLM choice)', () => {
  const records = [
    { nct_id: 'NCT07165028', acronym: 'SYNERGY-Outcomes', brief_title: 'A Master Protocol of Multiple Agents' },
    { nct_id: 'NCT04184622', acronym: null, brief_title: 'A Study of Tirzepatide in Obesity (SURMOUNT-1)' },
  ];

  it('renames a new trial to its CT.gov acronym, keyed by NCT id', () => {
    const proposals = { trials: [{ name: 'long LLM-chosen title', match: { kind: 'new', name: 'NCT07165028' } }] };
    applyNctTrialNames(proposals, records);
    expect(proposals.trials[0].name).toBe('SYNERGY-Outcomes');
  });

  it('renames to the brief title when the record has no acronym', () => {
    const proposals = { trials: [{ name: 'whatever', match: { kind: 'new', name: 'NCT04184622' } }] };
    applyNctTrialNames(proposals, records);
    expect(proposals.trials[0].name).toBe('A Study of Tirzepatide in Obesity (SURMOUNT-1)');
  });

  it('matches the NCT id case-insensitively', () => {
    const proposals = { trials: [{ name: 'x', match: { kind: 'new', name: 'nct07165028' } }] };
    applyNctTrialNames(proposals, records);
    expect(proposals.trials[0].name).toBe('SYNERGY-Outcomes');
  });

  it('leaves a trial untouched when its match is not an NCT in the record set', () => {
    const proposals = { trials: [{ name: 'Existing Trial Name', match: { kind: 'existing', id: 'uuid-1' } }] };
    applyNctTrialNames(proposals, records);
    expect(proposals.trials[0].name).toBe('Existing Trial Name');
  });
});
