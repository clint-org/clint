import { computed, Injectable, signal } from '@angular/core';

export interface SourceImportDropped {
  type: string;
  index: number;
  name: string;
  reason: string;
}

export interface FuzzyAlternate {
  id: string;
  name: string;
  score: number;
}

export interface CtgovCandidate {
  nct_id: string;
  brief_title: string;
  score: number;
  status: string;
  phase: string;
}

export interface SourceImportProposals {
  source_summary: string;
  source_title: string | null;
  source_date: string | null;
  companies: Record<string, unknown>[];
  assets: Record<string, unknown>[];
  trials: Record<string, unknown>[];
  events: Record<string, unknown>[];
}

export interface SourceImportProposal {
  ai_call_id: string;
  source_kind: 'url' | 'text' | 'nct';
  source_url: string | null;
  source_text: string;
  source_text_hash: string;
  source_title: string | null;
  source_date: string | null;
  source_summary: string;
  proposals: SourceImportProposals;
  dropped: SourceImportDropped[];
  fuzzy_alternates: Record<string, FuzzyAlternate[]>;
  ctgov_candidates: Record<string, CtgovCandidate[]>;
  inventory_snapshot_hash: string;
  warnings: string[];
  resolved_names: Record<string, string>;
  resolved_identifiers: Record<string, string>;
}

@Injectable({ providedIn: 'root' })
export class SourceImportService {
  private readonly _proposal = signal<SourceImportProposal | null>(null);

  readonly proposal = this._proposal.asReadonly();
  readonly hasProposal = computed(() => this._proposal() !== null);

  setProposal(p: SourceImportProposal): void {
    this._proposal.set(p);
  }

  clearProposal(): void {
    this._proposal.set(null);
  }
}
