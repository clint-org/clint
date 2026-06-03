import type { Trial } from '../models/trial.model';

export interface TrialOption {
  id: string;
  label: string;
  briefTitle: string;
  identifier: string;
  companyName: string;
  assetName: string;
}

export function toTrialOption(trial: Trial): TrialOption {
  const acronym = trial.acronym?.trim() ?? '';
  const name = trial.name ?? '';
  return {
    id: trial.id,
    label: acronym || name,
    briefTitle: name,
    identifier: trial.identifier ?? '',
    companyName: trial.assets?.companies?.name ?? '',
    assetName: trial.assets?.name ?? '',
  };
}
