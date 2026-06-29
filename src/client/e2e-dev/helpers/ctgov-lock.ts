/**
 * Force a scratch trial into the CT.gov-locked phase state WITHOUT a real registry
 * sync (the scratch world cannot reach clinicaltrials.gov for a synthetic NCT).
 *
 * Sets public.trials.phase_type_source = 'ctgov', which is exactly what
 * trial-edit-dialog.component.ts (phaseTypeLocked = trial.phase_type_source === 'ctgov')
 * reads to disable the Phase select and show the 'ct.gov' provenance badge.
 *
 * Uses the write-capable pooler directly (same pattern as helpers/scratch-world.ts);
 * no RLS in the way because the pooler connects as the DB owner.
 */
import { Client as PgClient } from 'pg';
import { requirePoolerUrl } from './dev-env';

export async function lockTrialPhaseFromCtgov(trialId: string, phaseType = 'P3'): Promise<void> {
  const pg = new PgClient({ connectionString: requirePoolerUrl() });
  await pg.connect();
  try {
    await pg.query(
      `update public.trials
          set phase_type = $2,
              phase_type_source = 'ctgov'
        where id = $1`,
      [trialId, phaseType]
    );
  } finally {
    await pg.end();
  }
}
