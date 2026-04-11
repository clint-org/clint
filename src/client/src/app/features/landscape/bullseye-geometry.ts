/**
 * Pure geometry helpers for the landscape bullseye chart.
 *
 * Coordinate system: SVG user space, viewBox 0 0 1000 1000 centered on
 * (CX, CY). Rings are concentric circles; spokes are radial lines from
 * the center to the outer ring. Each company is assigned an angular
 * sector around the circle, clockwise from 12 o'clock.
 *
 * Ring-rank convention: LAUNCHED is innermost, PRECLIN is the outer
 * rim. A product's development rank (0..6, earliest -> latest) is
 * inverted to a ring rank when picking a radius, so "most advanced"
 * reads toward the center of the chart.
 */

export const CX = 500;
export const CY = 500;
export const INNER_RADIUS = 95;
export const OUTER_RADIUS = 335;
export const LABEL_MARGIN = 40;
export const RINGS = 7;

/** Max clockwise offset (in radians) used when jittering overlapping dots. */
const MAX_JITTER_RADIANS = 0.25;
/** Fraction of a company's sector width available for jitter. */
const JITTER_SECTOR_FRACTION = 0.35;
/** Maximum number of dots rendered individually before collapsing to "+N". */
export const MAX_DOTS_PER_GROUP = 4;

/**
 * Ring radius for a product at `devRank` (0=PRECLIN ... 6=LAUNCHED).
 * Inverts the dev rank so LAUNCHED (6) lands at the innermost ring
 * (ringRank 0) and PRECLIN (0) lands at the outer rim (ringRank 6).
 */
export function ringRadius(devRank: number): number {
  const ringRank = RINGS - 1 - devRank;
  const step = (OUTER_RADIUS - INNER_RADIUS) / (RINGS - 1);
  return INNER_RADIUS + step * ringRank;
}

/**
 * Angle (radians) for a company's spoke, clockwise from 12 o'clock.
 * Index 0 is at 12 o'clock; angles increase clockwise.
 */
export function companyAngle(index: number, total: number): number {
  if (total <= 0) return -Math.PI / 2;
  const deg = -90 + (360 / total) * index;
  return (deg * Math.PI) / 180;
}

/** Angular width of a single company sector. */
export function sectorWidth(total: number): number {
  return total > 0 ? (2 * Math.PI) / total : 2 * Math.PI;
}

/**
 * Convert polar (angle, radius) to cartesian XY centered on (CX, CY).
 */
export function polarToCartesian(angle: number, radius: number): { x: number; y: number } {
  return {
    x: CX + radius * Math.cos(angle),
    y: CY + radius * Math.sin(angle),
  };
}

/**
 * Cartesian position of a single dot on a company spoke at a given dev rank.
 */
export function dotXY(
  companyIndex: number,
  totalCompanies: number,
  devRank: number
): { x: number; y: number } {
  return polarToCartesian(companyAngle(companyIndex, totalCompanies), ringRadius(devRank));
}

/**
 * Spread `k` overlapping dots across a small arc within a company's sector.
 * Returns `k` angles, symmetric around `centerAngle`.
 */
export function jitterAngles(centerAngle: number, sectorWidthRad: number, k: number): number[] {
  if (k <= 0) return [];
  if (k === 1) return [centerAngle];
  const maxOffset = Math.min(sectorWidthRad * JITTER_SECTOR_FRACTION, MAX_JITTER_RADIANS);
  const result: number[] = [];
  for (let i = 0; i < k; i += 1) {
    const t = k === 1 ? 0 : (2 * i) / (k - 1) - 1; // [-1, +1]
    result.push(centerAngle + maxOffset * t);
  }
  return result;
}

/**
 * SVG path string for a full annular ring band (between two concentric
 * radii, full 360 degrees). Uses fill-rule="evenodd" so the inner circle
 * cuts a hole. Used for tinted phase-band backgrounds.
 */
export function annularBandPath(outerRadius: number, innerRadius: number): string {
  // Two complete circles drawn in opposite directions; with fill-rule
  // evenodd this produces an annulus (donut) shape.
  return [
    `M ${CX - outerRadius},${CY}`,
    `A ${outerRadius},${outerRadius} 0 1 0 ${CX + outerRadius},${CY}`,
    `A ${outerRadius},${outerRadius} 0 1 0 ${CX - outerRadius},${CY}`,
    'Z',
    `M ${CX - innerRadius},${CY}`,
    `A ${innerRadius},${innerRadius} 0 1 1 ${CX + innerRadius},${CY}`,
    `A ${innerRadius},${innerRadius} 0 1 1 ${CX - innerRadius},${CY}`,
    'Z',
  ].join(' ');
}

/**
 * SVG path string for one company's annular wedge — the pie-slice between
 * INNER_RADIUS and OUTER_RADIUS that visually represents the company's
 * angular territory. Used for the alternating-tint sector backgrounds so
 * each company "owns" a clearly visible wedge of the chart.
 */
export function sectorAnnularPath(companyIndex: number, total: number): string {
  if (total <= 0) return '';
  const stepRad = (2 * Math.PI) / total;
  const base = companyAngle(companyIndex, total);
  const startAngle = base - stepRad / 2;
  const endAngle = base + stepRad / 2;

  const innerStart = polarToCartesian(startAngle, INNER_RADIUS);
  const outerStart = polarToCartesian(startAngle, OUTER_RADIUS);
  const innerEnd = polarToCartesian(endAngle, INNER_RADIUS);
  const outerEnd = polarToCartesian(endAngle, OUTER_RADIUS);

  const largeArc = stepRad > Math.PI ? 1 : 0;

  return [
    `M ${innerStart.x},${innerStart.y}`,
    `L ${outerStart.x},${outerStart.y}`,
    `A ${OUTER_RADIUS},${OUTER_RADIUS} 0 ${largeArc} 1 ${outerEnd.x},${outerEnd.y}`,
    `L ${innerEnd.x},${innerEnd.y}`,
    `A ${INNER_RADIUS},${INNER_RADIUS} 0 ${largeArc} 0 ${innerStart.x},${innerStart.y}`,
    'Z',
  ].join(' ');
}

/**
 * Positioning info for a company label: the text anchor point and a
 * rotation angle that keeps the text upright (text in the bottom
 * hemisphere is flipped 180 degrees so it still reads left-to-right).
 */
export interface CompanyLabelTransform {
  x: number;
  y: number;
  rotate: number;
  anchor: 'start' | 'end';
}

export function companyLabelTransform(angleRad: number, offset = 28): CompanyLabelTransform {
  const x = CX + (OUTER_RADIUS + offset) * Math.cos(angleRad);
  const y = CY + (OUTER_RADIUS + offset) * Math.sin(angleRad);
  const deg = (angleRad * 180) / Math.PI;
  // Normalize deg to the [-180, 180] range for the flip check.
  const normalized = ((((deg + 180) % 360) + 360) % 360) - 180;
  const flip = normalized > 90 || normalized < -90;
  const rotate = flip ? normalized + 180 : normalized;
  const anchor: 'start' | 'end' = flip ? 'end' : 'start';
  return { x, y, rotate, anchor };
}
