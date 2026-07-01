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

// The trial acronym (query.titles) is a near-unique identifier and the strongest
// CT.gov signal. The tight query adds the structured sponsor + phase constraints;
// the title-only fallback drops them so a sponsor/phase mismatch can't hide a real
// record. The model's free-text condition/intervention are deliberately omitted:
// the v2 API ANDs every query.* param, so those verbose values zero out otherwise
// valid matches (the reason multi-trial press releases came back with no NCTs).
function buildSearchUrl(
  trial: ExtractionResult['trials'][number],
  companyName: string | undefined,
  titleOnly = false
): string {
  const params = new URLSearchParams({
    pageSize: '10',
    format: 'json',
  });

  params.set('query.titles', trial.name);
  if (!titleOnly) {
    if (companyName) params.set('query.spons', companyName);
    if (trial.phase) {
      const mapped = PHASE_MAP[trial.phase];
      if (mapped) params.set('filter.advanced', `AREA[Phase]${mapped}`);
    }
  }

  return `${CTGOV_BASE}?${params.toString()}`;
}

// A verbatim acronym occurrence in the brief title (typically parenthesised, e.g.
// "...Advanced Solid Tumors (TROPION-PanTumor01)") is a definitive identifier.
// Raw Jaro-Winkler over the whole long title scores such matches ~0.4, below any
// confidence bar, so treat an exact case-insensitive substring as a perfect match.
function scoreTitleMatch(briefTitle: string, trialName: string): number {
  const needle = trialName.trim().toLowerCase();
  if (needle.length >= 4 && briefTitle.toLowerCase().includes(needle)) return 1;
  return jaroWinkler(briefTitle, trialName);
}

function rankStudies(studies: CtgovStudy[], trialName: string): CtgovCandidate[] {
  return studies
    .map((s) => {
      const id = s.protocolSection?.identificationModule;
      const briefTitle = id?.briefTitle ?? '';
      return {
        nct_id: id?.nctId ?? '',
        brief_title: briefTitle,
        score: scoreTitleMatch(briefTitle, trialName),
        status: s.protocolSection?.statusModule?.overallStatus ?? 'UNKNOWN',
        phase: (s.protocolSection?.designModule?.phases ?? []).join('/') || 'N/A',
      };
    })
    .filter((c) => c.nct_id)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);
}

function needsCtgovLookup(trial: ExtractionResult['trials'][number]): boolean {
  // A trial that already carries an NCT is enriched from its exact registry
  // record (see ctgov-record-enrich), so the fuzzy name-search candidates would
  // be redundant noise in the picker. Only fuzzy-search trials with no NCT.
  return trial.match.kind === 'new' && !trial.nct_id;
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

  // Fetch a CT.gov search URL; returns the studies array, or null on a non-OK
  // response (a distinct "partial" signal vs. an empty-but-successful result).
  const runQuery = async (url: string): Promise<CtgovStudy[] | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      const body = (await res.json()) as { studies?: CtgovStudy[] };
      return body.studies ?? [];
    } finally {
      clearTimeout(timer);
    }
  };

  const tasks = proposals.trials.map(async (trial, idx) => {
    if (!needsCtgovLookup(trial)) return;

    const key = String(idx);
    const companyName = companyNames[trial.sponsor_ref];

    try {
      let studies = await runQuery(buildSearchUrl(trial, companyName, false));
      if (studies === null) {
        warnings.push(`ctgov_partial:trial_${idx}`);
        return;
      }
      // The tight query can zero out on a sponsor/phase mismatch; retry by title
      // alone before giving up (the acronym is a near-unique identifier).
      if (studies.length === 0) {
        studies = await runQuery(buildSearchUrl(trial, companyName, true));
        if (studies === null) {
          warnings.push(`ctgov_partial:trial_${idx}`);
          return;
        }
      }

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
