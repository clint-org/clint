/**
 * Row-level decollision for marker date labels.
 *
 * Each marker renders its own "Mon 'YY" caption centered under the icon.
 * Markers are positioned independently, so clustered catalysts used to
 * print their captions on top of each other ("JunJa'26'26"). This picks,
 * per row, the subset of markers whose captions can render without
 * overlapping: sort by x, then greedily keep a caption only when it sits
 * at least `minGap` px right of the previously kept one. Suppressed
 * captions stay reachable through the marker tooltip, which carries the
 * full date.
 */
export interface MarkerPoint {
  id: string;
  x: number;
}

export function visibleLabelMarkerIds(points: MarkerPoint[], minGap: number): Set<string> {
  const kept = new Set<string>();
  const sorted = [...points].sort((a, b) => a.x - b.x);
  let lastKeptX = Number.NEGATIVE_INFINITY;
  for (const p of sorted) {
    if (p.x - lastKeptX >= minGap) {
      kept.add(p.id);
      lastKeptX = p.x;
    }
  }
  return kept;
}
