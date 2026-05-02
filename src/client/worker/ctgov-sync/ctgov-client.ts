/**
 * CT.gov API adapter.
 *
 * Single source of truth for CT.gov URL shapes. If `/api/int/` shape-shifts or
 * CT.gov ships a v3, the change is in this one file.
 *
 * - `fetchStudy`            -> `/api/v2/studies/{nctId}` (full payload).
 * - `fetchSummariesBatch`   -> `/api/v2/studies?query.term=...&fields=...` (watermark batch).
 * - `fetchHistory`          -> `/api/int/studies/{nctId}/history` (opportunistic; never throws).
 *
 * See spec section "CT.gov API access (hybrid)" in
 * docs/superpowers/specs/2026-05-02-trial-change-feed-design.md.
 */

import type { CtgovStudySummary, CtgovHistoryEntry } from './types';

export interface CtgovClientOptions {
  baseUrl: string;
  userAgent?: string;
}

export interface CtgovClient {
  fetchStudy(nctId: string): Promise<unknown | null>;
  fetchSummariesBatch(nctIds: string[]): Promise<CtgovStudySummary[]>;
  fetchHistory(nctId: string): Promise<CtgovHistoryEntry[] | null>;
}

interface SummaryStudyShape {
  protocolSection?: {
    identificationModule?: { nctId?: string };
    statusModule?: { lastUpdatePostDateStruct?: { date?: string } };
  };
}

export function createCtgovClient(opts: CtgovClientOptions): CtgovClient {
  const headers: Record<string, string> = {
    'User-Agent': opts.userAgent ?? 'clint-worker/1.0',
  };

  return {
    async fetchStudy(nctId: string): Promise<unknown | null> {
      const res = await fetch(`${opts.baseUrl}/api/v2/studies/${nctId}`, { headers });
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`ctgov fetchStudy ${nctId} failed: ${res.status}`);
      }
      return await res.json();
    },

    async fetchSummariesBatch(nctIds: string[]): Promise<CtgovStudySummary[]> {
      // CT.gov v2 expects `query.term=(NCT01 OR NCT02)` with `+` as space separator.
      // encodeURIComponent uses %20 for spaces; swap to `+` to match the wire format.
      const term = encodeURIComponent(`(${nctIds.join(' OR ')})`).replace(/%20/g, '+');
      const fields = encodeURIComponent('NCTId,LastUpdatePostDate');
      const url = `${opts.baseUrl}/api/v2/studies?query.term=${term}&fields=${fields}&pageSize=${nctIds.length}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`ctgov fetchSummariesBatch failed: ${res.status}`);
      }
      const json = (await res.json()) as { studies?: SummaryStudyShape[] };
      const studies = json.studies ?? [];
      const summaries: CtgovStudySummary[] = [];
      for (const s of studies) {
        const nctId = s.protocolSection?.identificationModule?.nctId;
        const lastUpdatePostDate =
          s.protocolSection?.statusModule?.lastUpdatePostDateStruct?.date;
        if (!nctId || !lastUpdatePostDate) continue;
        summaries.push({ nctId, lastUpdatePostDate });
      }
      return summaries;
    },

    async fetchHistory(nctId: string): Promise<CtgovHistoryEntry[] | null> {
      // Opportunistic: any failure (HTTP, parse, network) returns null. We never throw.
      try {
        const res = await fetch(`${opts.baseUrl}/api/int/studies/${nctId}/history`, {
          headers,
        });
        if (!res.ok) return null;
        const text = await res.text();
        try {
          const json = JSON.parse(text) as { changes?: CtgovHistoryEntry[] };
          return json.changes ?? null;
        } catch {
          return null;
        }
      } catch {
        return null;
      }
    },
  };
}
