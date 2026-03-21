import { Injectable } from '@angular/core';
import { Trial } from '../models/trial.model';

/* eslint-disable @typescript-eslint/no-explicit-any */

const CTGOV_API = 'https://clinicaltrials.gov/api/v2/studies';

@Injectable({ providedIn: 'root' })
export class CtgovSyncService {
  async fetchAndMap(nctId: string): Promise<Partial<Trial>> {
    const url = `${CTGOV_API}/${nctId}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`ClinicalTrials.gov returned ${res.status} for ${nctId}`);
    }
    const study = await res.json();
    return this.mapStudy(study);
  }

  private mapStudy(study: any): Partial<Trial> {
    const proto = study.protocolSection ?? {};
    const id = proto.identificationModule ?? {};
    const status = proto.statusModule ?? {};
    const design = proto.designModule ?? {};
    const elig = proto.eligibilityModule ?? {};
    const arms = proto.armsInterventionsModule ?? {};
    const conds = proto.conditionsModule ?? {};
    const outcomes = proto.outcomesModule ?? {};
    const oversight = proto.oversightModule ?? {};
    const sponsor = proto.sponsorCollaboratorsModule ?? {};
    const contacts = proto.contactsLocationsModule ?? {};

    const interventions = arms.interventions ?? [];
    const firstIntervention = interventions[0] ?? {};

    const countries = this.extractCountries(contacts);
    const regions = this.inferRegions(countries);

    const mapped: Partial<Trial> = {
      name: id.officialTitle ?? id.briefTitle ?? undefined,
      identifier: id.nctId ?? undefined,
      sample_size: design.enrollmentInfo?.count ?? undefined,

      // logistics
      recruitment_status: status.overallStatus ?? undefined,
      lead_sponsor: sponsor.leadSponsor?.name ?? undefined,
      sponsor_type: this.mapSponsorClass(sponsor.leadSponsor?.class),
      collaborators: (sponsor.collaborators ?? []).map((c: any) => c.name),
      study_countries: countries,
      study_regions: regions,

      // scientific design
      study_type: design.studyType ?? undefined,
      phase: this.mapPhase(design.phases),
      design_allocation: design.designInfo?.allocation ?? undefined,
      design_intervention_model: design.designInfo?.interventionModel ?? undefined,
      design_masking: this.mapMasking(design.designInfo?.maskingInfo),
      design_primary_purpose: design.designInfo?.primaryPurpose ?? undefined,
      enrollment_type: design.enrollmentInfo?.type ?? undefined,

      // clinical context
      conditions: conds.conditions ?? [],
      intervention_type: firstIntervention.type ?? undefined,
      intervention_name:
        interventions
          .map((i: any) => i.name)
          .filter(Boolean)
          .join(', ') || undefined,
      primary_outcome_measures: (outcomes.primaryOutcomes ?? []).map((o: any) => o.measure),
      secondary_outcome_measures: (outcomes.secondaryOutcomes ?? []).map((o: any) => o.measure),

      // eligibility
      eligibility_sex: elig.sex ?? undefined,
      eligibility_min_age: elig.minimumAge ?? undefined,
      eligibility_max_age: elig.maximumAge ?? undefined,
      accepts_healthy_volunteers: elig.healthyVolunteers ?? undefined,
      eligibility_criteria: elig.eligibilityCriteria ?? undefined,
      sampling_method: elig.samplingMethod ?? undefined,

      // timeline
      start_date: this.parseCtgovDate(status.startDateStruct),
      start_date_type: status.startDateStruct?.type ?? undefined,
      primary_completion_date: this.parseCtgovDate(status.primaryCompletionDateStruct),
      primary_completion_date_type: status.primaryCompletionDateStruct?.type ?? undefined,
      study_completion_date: this.parseCtgovDate(status.completionDateStruct),
      study_completion_date_type: status.completionDateStruct?.type ?? undefined,
      first_posted_date: this.parseCtgovDate(status.studyFirstPostDateStruct),
      results_first_posted_date: this.parseCtgovDate(status.resultsFirstPostDateStruct),
      last_update_posted_date: this.parseCtgovDate(status.lastUpdatePostDateStruct),

      // regulatory
      has_dmc: oversight.oversightHasDmc ?? undefined,
      is_fda_regulated_drug: oversight.isFdaRegulatedDrug ?? undefined,
      is_fda_regulated_device: oversight.isFdaRegulatedDevice ?? undefined,

      ctgov_last_synced_at: new Date().toISOString(),
    };

    // clean undefined values
    return Object.fromEntries(
      Object.entries(mapped).filter(([, v]) => v !== undefined)
    ) as Partial<Trial>;
  }

  private mapPhase(phases: string[] | undefined): string | undefined {
    if (!phases || phases.length === 0) return undefined;
    return phases
      .join('/')
      .replace('EARLY_PHASE1', 'Early Phase 1')
      .replace('PHASE1', 'Phase 1')
      .replace('PHASE2', 'Phase 2')
      .replace('PHASE3', 'Phase 3')
      .replace('PHASE4', 'Phase 4')
      .replace('NA', 'N/A');
  }

  private mapMasking(info: any): string | undefined {
    if (!info) return undefined;
    if (info.masking === 'NONE') return 'None (Open Label)';
    const who = info.whoMasked ?? [];
    if (who.length >= 4) return 'Quadruple';
    if (who.length === 3) return 'Triple';
    if (who.length === 2) return 'Double';
    if (who.length === 1) return 'Single';
    return info.masking ?? undefined;
  }

  private mapSponsorClass(cls: string | undefined): string | undefined {
    if (!cls) return undefined;
    const map: Record<string, string> = {
      INDUSTRY: 'Industry',
      NIH: 'NIH',
      FED: 'Other U.S. Federal',
      OTHER: 'Academic/Non-profit',
      OTHER_GOV: 'Other Government',
      NETWORK: 'Network',
    };
    return map[cls] ?? cls;
  }

  private extractCountries(contacts: any): string[] {
    const locations = contacts.locations ?? [];
    const countries = new Set<string>();
    for (const loc of locations) {
      if (loc.country) countries.add(loc.country);
    }
    return [...countries];
  }

  private inferRegions(countries: string[]): string[] {
    const regionMap: Record<string, string> = {
      'United States': 'North America',
      Canada: 'North America',
      Mexico: 'North America',
      Germany: 'Europe',
      France: 'Europe',
      'United Kingdom': 'Europe',
      Spain: 'Europe',
      Italy: 'Europe',
      Netherlands: 'Europe',
      Belgium: 'Europe',
      Sweden: 'Europe',
      Poland: 'Europe',
      Switzerland: 'Europe',
      Austria: 'Europe',
      Japan: 'Asia Pacific',
      China: 'Asia Pacific',
      'South Korea': 'Asia Pacific',
      Australia: 'Asia Pacific',
      India: 'Asia Pacific',
      Taiwan: 'Asia Pacific',
      Brazil: 'Latin America',
      Argentina: 'Latin America',
      Colombia: 'Latin America',
    };
    const regions = new Set<string>();
    for (const c of countries) {
      if (regionMap[c]) regions.add(regionMap[c]);
    }
    return [...regions];
  }

  private parseCtgovDate(dateStruct: any): string | undefined {
    if (!dateStruct?.date) return undefined;
    const d = dateStruct.date;
    if (d.length === 7) return `${d}-01`;
    return d;
  }
}
