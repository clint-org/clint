/**
 * Row-level decollision for marker date labels.
 *
 * Each marker renders its own "Mon 'YY" caption centered under the icon, and a
 * ranged marker also renders a smaller end-cap caption ("~Q1 '27") at the end
 * of its tail. Markers are positioned independently, so clustered catalysts
 * used to print captions on top of each other ("JunJa'26'26"). Two passes keep
 * the page legible:
 *
 *  1. Start captions (the primary date) win their slots first: sort by x, then
 *     greedily keep a caption only when it sits at least `minGap` px right of
 *     the previously kept one.
 *  2. End-cap captions are secondary -- they only render when they clear every
 *     kept start caption (and each other) by a small pad. An end-cap is
 *     width-aware because its text is left-anchored at the tail end and can be
 *     wider than the start container.
 *
 * Suppressed captions stay reachable through the marker tooltip, which carries
 * the full date and range.
 */
export interface MarkerPoint {
  id: string;
  x: number;
}

/** A caption occupying a horizontal interval `[left, right]` in row px. */
export interface CaptionInterval {
  key: string;
  left: number;
  right: number;
}

/** Monospace advance of the 8px caption font, measured in-browser. */
export const CAPTION_CHAR_PX = 4.82;

/** Estimated rendered width (px) of a caption string at the timeline font. */
export function estimateCaptionWidthPx(label: string, charPx: number = CAPTION_CHAR_PX): number {
  return label.length * charPx;
}

/**
 * Greedy left-to-right keep of start captions. A caption is kept only when its
 * center sits at least `minGap` px right of the previously kept caption's
 * center, so two captions never print on top of each other.
 */
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

/**
 * Place secondary (optional) captions around already-placed ones. The
 * `occupied` intervals are fixed (e.g. kept start captions); each optional
 * caption is kept only when it clears every occupied interval -- and every
 * earlier-kept optional caption -- by at least `pad` px. Returns the keys of
 * the optional captions that may render.
 */
export function placeOptionalCaptions(
  occupied: CaptionInterval[],
  optional: CaptionInterval[],
  pad: number
): Set<string> {
  const kept = new Set<string>();
  const placed: CaptionInterval[] = [...occupied];
  const clears = (iv: CaptionInterval): boolean =>
    placed.every((o) => iv.right + pad <= o.left || iv.left - pad >= o.right);
  for (const iv of [...optional].sort((a, b) => a.left - b.left)) {
    if (clears(iv)) {
      kept.add(iv.key);
      placed.push(iv);
    }
  }
  return kept;
}
