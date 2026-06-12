/**
 * Browser canvas allocation caps. Safari enforces the most restrictive
 * mainstream limits: 16384 px per side and 268,435,456 total pixels.
 * Exceeding either fails silently (blank canvas), so exports clamp their
 * scale instead of failing.
 */
export const MAX_CANVAS_SIDE = 16384;
export const MAX_CANVAS_AREA = 268_435_456;

/**
 * Largest scale, capped at target, that keeps width x height within the
 * canvas limits. The area term is redundant while MAX_CANVAS_AREA equals
 * MAX_CANVAS_SIDE squared, but guards against either constant changing
 * independently.
 */
export function clampExportScale(width: number, height: number, target = 2): number {
  if (width <= 0 || height <= 0) return target;
  return Math.min(
    target,
    MAX_CANVAS_SIDE / width,
    MAX_CANVAS_SIDE / height,
    Math.sqrt(MAX_CANVAS_AREA / (width * height))
  );
}
