import jaroWinkler from 'jaro-winkler';
import type { ExtractionResult, CtgovCandidate } from './types';

export interface CtgovEnrichmentResult {
  candidates: Record<string, CtgovCandidate[]>;
  warnings: string[];
}

const CTGOV_BASE = 'https://clinicaltrials.gov/api/v2/studies';
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_CANDIDATES = 3;

const PHASE_MAP: Record<string, string> = {
  P1: 'PHASE1',
  P1_2: 'PHASE1|PHASE2',
  P2: 'PHASE2',
  P2_3: 'PHASE2|PHASE3',
  P3: 'PHASE3',
  P4: 'PHASE4',
};

interface CtgovStudy {
  protocolSection?: {
    identificationModule?: {
      nctId?: string;
      briefTitle?: string;
    };
    statusModule?: {
      overallStatus?: string;
    };
    designModule?: {
      phases?: string[];
    };
  };
}

function buildSearchUrl(
  trial: ExtractionResult['trials'][number],
  companyName: string | undefined,
  assetName: string | undefined
): string {
  const params = new URLSearchParams({
    pageSize: '10',
    format: 'json',
  });

  if (companyName) params.set('query.spons', companyName);
  params.set('query.titles', trial.name);
  if (trial.indication) params.set('query.cond', trial.indication);
  if (assetName) params.set('query.intr', assetName);
  if (trial.phase) {
    const mapped = PHASE_MAP[trial.phase];
    if (mapped) params.set('filter.advanced', `AREA[Phase]${mapped}`);
  }

  return `${CTGOV_BASE}?${params.toString()}`;
}

function rankStudies(studies: CtgovStudy[], trialName: string): CtgovCandidate[] {
  return studies
    .map((s) => {
      const id = s.protocolSection?.identificationModule;
      const briefTitle = id?.briefTitle ?? '';
      return {
        nct_id: id?.nctId ?? '',
        brief_title: briefTitle,
        score: jaroWinkler(briefTitle, trialName),
        status: s.protocolSection?.statusModule?.overallStatus ?? 'UNKNOWN',
        phase: (s.protocolSection?.designModule?.phases ?? []).join('/') || 'N/A',
      };
    })
    .filter((c) => c.nct_id)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);
}

function needsCtgovLookup(trial: ExtractionResult['trials'][number]): boolean {
  return trial.match.kind === 'new';
}

export async function enrichWithCtgov(
  proposals: ExtractionResult,
  companyNames: string[],
  assetNames: string[],
  options?: { timeout?: number }
): Promise<CtgovEnrichmentResult> {
  const timeoutMs = options?.timeout ?? DEFAULT_TIMEOUT_MS;
  const candidates: Record<string, CtgovCandidate[]> = {};
  const warnings: string[] = [];

  const tasks = proposals.trials.map(async (trial, idx) => {
    if (!needsCtgovLookup(trial)) return;

    const key = String(idx);
    const companyName = companyNames[trial.sponsor_ref];
    const assetName = trial.asset_ref != null ? assetNames[trial.asset_ref] : undefined;
    const url = buildSearchUrl(trial, companyName, assetName);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) {
        warnings.push(`ctgov_partial:trial_${idx}`);
        return;
      }

      const body = (await res.json()) as { studies?: CtgovStudy[] };
      const studies = body.studies ?? [];
      const ranked = rankStudies(studies, trial.name);

      if (ranked.length > 0) {
        candidates[key] = ranked;
      }
    } catch {
      warnings.push(`ctgov_partial:trial_${idx}`);
    }
  });

  await Promise.all(tasks);

  return { candidates, warnings };
}
