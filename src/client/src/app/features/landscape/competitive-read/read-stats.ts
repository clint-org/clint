import { Company } from '../../../core/models/company.model';
import { BullseyeSpoke } from '../../../core/models/landscape.model';

export interface ReadStats {
  name: string;
  assetCount: number;
  trialCount: number;
  p3Count: number;
  lateStageCount: number;
  recentChanges: number;
  highestPhase: string;
  highestPhaseRank: number;
  upcomingCatalysts?: ReadCatalyst[];
}

export interface ReadCatalyst {
  daysOut: number;
  trialName: string;
  eventDate: string;
}

export function fromCompanies(_companies: Company[], _today?: string): ReadStats[] {
  throw new Error('not implemented');
}

export function fromSpokes(_spokes: BullseyeSpoke[]): ReadStats[] {
  throw new Error('not implemented');
}
