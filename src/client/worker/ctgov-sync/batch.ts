/**
 * Batch helpers for the CT.gov sync pipeline.
 *
 * Pure functions only: no I/O, no globals. See the spec section
 * "Cloudflare Worker poller / File layout" in
 * docs/superpowers/plans/2026-05-02-trial-change-feed.md for context.
 */

import type { PollingTrialRow } from './types';

// chunkBy splits an array into N-sized chunks. The final chunk may be smaller.
// Returns [] for an empty input.
export function chunkBy<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// groupByNct groups PollingTrialRow objects by their nct_id. Multiple trials
// in different spaces can share an NCT (whitelabel multi-tenant case).
// Insertion order within each group is preserved.
export function groupByNct(rows: PollingTrialRow[]): Map<string, PollingTrialRow[]> {
  const groups = new Map<string, PollingTrialRow[]>();
  for (const row of rows) {
    const existing = groups.get(row.nct_id);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(row.nct_id, [row]);
    }
  }
  return groups;
}
