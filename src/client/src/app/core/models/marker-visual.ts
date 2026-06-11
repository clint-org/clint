import type { FillStyle, InnerMark, Marker, MarkerShape } from './marker.model';

/**
 * Semantic descriptor for a single marker glyph. This is the single source of
 * truth for WHAT to draw; each surface (Angular SVG icons, PPTX export) renders
 * it in its own primitives but agrees on shape/fill/inner-mark/NLE.
 */
export interface MarkerVisual {
  shape: MarkerShape;
  color: string;
  fillStyle: FillStyle;
  innerMark: InnerMark;
  isNle: boolean;
}

/** Neutral fallback color when a marker has no resolved type. */
const FALLBACK_COLOR = '#64748b';

/**
 * Derive the visual descriptor from a marker row. Fill style is driven by
 * projection (actual = filled, everything else = outline), matching
 * marker.component.ts. Note: MarkerType.fill_style is intentionally NOT
 * forwarded here — the dashboard grid overrides it with projection semantics,
 * and this resolver is the single source of that rule. Never throws when
 * marker_types is absent.
 */
export function resolveMarkerVisual(marker: Marker): MarkerVisual {
  const type = marker.marker_types;
  return {
    shape: type?.shape ?? 'circle',
    color: type?.color ?? FALLBACK_COLOR,
    fillStyle: marker.projection === 'actual' ? 'filled' : 'outline',
    innerMark: type?.inner_mark ?? 'none',
    isNle: marker.no_longer_expected,
  };
}

/**
 * Fractional glyph geometry shared by the SVG icon components and the PPTX
 * glyph. All values are fractions of the glyph's box size, so each renderer
 * scales to its own coordinate system. Stroke widths are NOT shared -- they are
 * unit-specific (px on screen, pt in OOXML) and stay in each renderer.
 *
 * Values mirror the on-screen SVG icons (the visual reference).
 */
export const GLYPH_RATIOS = {
  /** Circle / diamond inner dot radius. */
  innerDotR: 0.15,
  /** Diamond half-width / half-height. */
  diamondHalfW: 0.42,
  diamondHalfH: 0.48,
  /** Square is inset by this fraction on each side (drawn box = 1 - 2*inset). */
  squareInset: 0.1,
  /** Circle 'dash' inner line horizontal endpoints. */
  circleDashX1: 0.28,
  circleDashX2: 0.72,
  /** Square 'x' inner line endpoints. */
  squareXMin: 0.3,
  squareXMax: 0.7,
  /** Flag pole x position, flag width, flag height. */
  flagPoleX: 0.15,
  flagWidth: 0.8,
  flagHeight: 0.6,
  /**
   * Flag banner rect approximation shared by the PPTX and canvas renderers
   * (the SVG icon draws a Bezier banner via flagWidth/flagHeight instead).
   */
  flagBannerW: 0.7,
  flagBannerH: 0.45,
  /** Triangle vertices (x1,y1,x2,y2,x3,y3). */
  trianglePoints: [0.15, 0.1, 0.9, 0.5, 0.15, 0.9] as const,
  /** Diamond 'check' polyline points (x1,y1,x2,y2,x3,y3). */
  checkPoints: [0.32, 0.5, 0.45, 0.65, 0.68, 0.38] as const,
} as const;

/**
 * Stroke widths shared by the SVG icon components and the canvas PNG glyph.
 * Values are absolute px regardless of glyph size (SVG stroke-width does not
 * scale with the viewBox), so both renderers read identically at any size.
 * The PPTX renderer keeps its own pt-based widths (OOXML units).
 */
export const GLYPH_STROKES = {
  /** Main shape outline (circle, diamond always; triangle, square only when outline). */
  shape: 1.5,
  /** Inner marks: dash, check, x. */
  innerMark: 2.5,
  /** NLE strike-through line. */
  nleStrike: 2.5,
  /** Flag banner outline width by fill style. */
  flagBannerOutline: 1.2,
  flagBannerFilled: 0.5,
  /** Dashed-line marker stroke width and dash pattern. */
  dashedLine: 1.5,
  dashedLinePattern: [4, 3],
} as const;
