import { toStudyRecord } from './nct-study-record';
import { mapCtgovStatus } from './nct-phase-map';
import { normalizeNctId } from './nct-id';
import type { ExtractionResult } from './types';

export interface CtgovRecordEnrichResult {
  warnings: string[];
  enriched: number[];
}

interface StudyFetcher {
  fetchStudy(nctId: string): Promise<unknown | null>;
}

// When extraction captured an NCT for a NEW trial, the ClinicalTrials.gov record
// is the system of record for that trial's structured facts. We fetch the exact
// study (reusing the NCT-list import machinery -- toStudyRecord, mapCtgovPhase,
// mapCtgovStatus) and backfill phase / dates / sample size / status. Registry
// values win when present; an absent registry field leaves the extracted value
// untouched. Mutates proposals.trials in place. Existing-matched trials are
// skipped (commit does not change their identity fields).
export async function enrichTrialsByNct(
  proposals: ExtractionResult,
  client: StudyFetcher,
  options?: { timeout?: number }
): Promise<CtgovRecordEnrichResult> {
  const warnings: string[] = [];
  const enriched: number[] = [];

  const tasks = proposals.trials.map(async (trial, idx) => {
    if (trial.match.kind !== 'new') return;
    const nct = normalizeNctId(trial.nct_id);
    if (!nct) return;

    let study: unknown | null;
    try {
      study = await withTimeout(client.fetchStudy(nct), options?.timeout);
    } catch {
      warnings.push(`ctgov_record_failed:trial_${idx}`);
      return;
    }
    if (study === null) {
      // 404 from CT.gov: the article cited an NCT that the registry does not
      // serve (typo, withdrawn-and-purged, or a non-NCT id that slipped the
      // format check). Keep the id and the extracted fields; just flag it.
      warnings.push(`ctgov_record_not_found:trial_${idx}`);
      return;
    }

    const record = toStudyRecord(study);
    const t = trial as Record<string, unknown>;
    if (record.phase) t['phase'] = record.phase;
    if (record.start_date) t['phase_start_date'] = record.start_date;
    if (record.primary_completion_date) t['phase_end_date'] = record.primary_completion_date;
    if (typeof record.enrollment_count === 'number') t['sample_size'] = record.enrollment_count;
    const status = mapCtgovStatus(record.overall_status);
    if (status) t['status'] = status;
    enriched.push(idx);
  });

  await Promise.all(tasks);
  return { warnings, enriched };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ctgov_record_timeout')), timeoutMs);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}
