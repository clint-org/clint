/**
 * Opacity-fade stops for a timeline phase bar's edge mask.
 *
 * A phase that is clipped at the window's left edge, or that has no end date
 * (ongoing) / extends past the right edge, dissolves at that edge instead of
 * being cut flat -- a true "feather" so the band reads as continuing into the
 * unknown. The fade is applied via an SVG mask whose gradient runs across the
 * bar (objectBoundingBox units); white keeps, transparent hides. This is the
 * single source of truth for the stop positions, kept pure for unit testing.
 */

export interface FadeStop {
  /** 0..1 position across the bar width. */
  offset: number;
  /** 1 = fully visible, 0 = fully faded. */
  opacity: number;
}

/**
 * Returns the mask gradient stops, or null when neither edge is open (no mask
 * needed -- the bar renders solid). `fadePx` is the pixel width of the fade;
 * it is converted to a fraction of the bar and capped so a narrow bar still
 * keeps a solid core.
 */
export function phaseFadeStops(
  width: number,
  openLeft: boolean,
  openRight: boolean,
  fadePx = 14
): FadeStop[] | null {
  if (width <= 0 || (!openLeft && !openRight)) return null;
  const frac = Math.min(Math.max(fadePx / width, 0.05), 0.45);
  const stops: FadeStop[] = [{ offset: 0, opacity: openLeft ? 0 : 1 }];
  if (openLeft) stops.push({ offset: frac, opacity: 1 });
  if (openRight) stops.push({ offset: 1 - frac, opacity: 1 });
  stops.push({ offset: 1, opacity: openRight ? 0 : 1 });
  return stops;
}
