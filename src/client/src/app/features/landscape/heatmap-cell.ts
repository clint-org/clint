/**
 * Pure cell-shading + freshness helpers for the heatmap. Kept out of
 * `heatmap.component.ts` so the plain-node unit runner can test them without
 * importing the component (which pulls in PrimeNG and triggers Angular JIT).
 */

/**
 * Absolute shade step (0-6) for a cell's count. Independent of the rest of
 * the heatmap and of the active count unit, so a given count always renders at
 * the same shade across the Assets / Trials / Companies toggle.
 */
export function heatmapStep(count: number): number {
  if (count <= 0) return 0;
  if (count <= 3) return count; // 1, 2, 3 map one-to-one
  if (count <= 5) return 4;
  if (count <= 9) return 5;
  return 6;
}

// Mix percentage of the phase hue over white per step. Capped well below full
// saturation so dark cell text keeps WCAG AA contrast on every phase color.
const STEP_MIX_PCT = [0, 14, 22, 30, 38, 46, 54];

/**
 * Background tint for a cell: the cell's own phase color mixed over white,
 * deeper as the count rises. Returns null for an empty cell. Color comes from
 * the fixed phase palette (data color), never the tenant brand color.
 */
export function cellTint(phaseColor: string, count: number): string | null {
  const step = heatmapStep(count);
  if (step === 0) return null;
  return `color-mix(in srgb, ${phaseColor} ${STEP_MIX_PCT[step]}%, white)`;
}

export function formatFreshness(isoDate: string | null, now: Date): string | null {
  if (!isoDate) return null;
  const then = new Date(isoDate);
  const diffMs = now.getTime() - then.getTime();
  if (diffMs < 0) return 'Updated just now';

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return 'Updated just now';
  if (hours < 24) return `Updated ${hours}h ago`;

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 7) return `Updated ${days}d ago`;

  const month = then.toLocaleString('en-US', { month: 'short' });
  const day = then.getDate();
  return `Updated ${month} ${day}`;
}
