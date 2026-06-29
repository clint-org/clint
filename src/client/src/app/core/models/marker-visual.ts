import type { FillStyle, InnerMark, Marker, MarkerShape, Projection } from './marker.model';

/**
 * Single-letter source badge drawn at the top-right of a projected glyph, used
 * only for dates whose source DEVIATES from the assumed default: `c`
 * company-guided, `f` forecasted (our model), `p` a non-registry primary source
 * on an asset/company anchor. `null` covers a confirmed actual date and a
 * `primary` projection on a trial (or with no anchor context), which is the
 * CT.gov registry estimate: the assumed default, so like `actual` it carries no
 * letter and the hollow fill alone marks it projected. On asset/company anchors
 * there is no registry default, so a `primary` projection there means a
 * non-registry primary source and badges `p`.
 */
export type ProjectionBadge = 'c' | 'p' | 'f' | null;

/**
 * Semantic descriptor for a single marker glyph. This is the single source of
 * truth for WHAT to draw; each surface (Angular SVG icons, PPTX export) renders
 * it in its own primitives but agrees on shape/fill/inner-mark/NLE/projection.
 */
export interface MarkerVisual {
  shape: MarkerShape;
  color: string;
  fillStyle: FillStyle;
  innerMark: InnerMark;
  isNle: boolean;
  /** Projection tier badge ('c'/'p'/'f'); null for a confirmed actual date. */
  projectionBadge: ProjectionBadge;
  /** Gentle confidence dim — solid for actual/company, lighter down the tiers. */
  opacity: number;
  /** Dashed outline — true only for the forecasted tier. */
  outlineDash: boolean;
}

/** Neutral fallback color when a marker has no resolved type. */
const FALLBACK_COLOR = '#64748b';

/**
 * Projection -> {badge, opacity}. Hollow fill marks any projected date; a letter
 * is added ONLY when the source deviates from the assumed default. `primary` (the
 * CT.gov registry estimate) is that default on a trial, so the base map gives it
 * no letter — only `company` guidance (`c`) and our own `forecasted` model (`f`)
 * do. The resolver overrides `primary` to `p` on asset/company anchors, where it
 * means a non-registry primary source. Opacity is a gentle dim reserved for the
 * least-confident forecast tier; the forecast also dashes its outline.
 */
const PROJECTION_VISUAL: Record<Projection, { badge: ProjectionBadge; opacity: number }> = {
  actual: { badge: null, opacity: 1 },
  company: { badge: 'c', opacity: 1 },
  primary: { badge: null, opacity: 1 },
  forecasted: { badge: 'f', opacity: 0.72 },
};

/**
 * A `primary` projection on a non-trial anchor (asset/company) is a non-registry
 * primary source and badges `p`. On a trial, or when the anchor is unknown,
 * `primary` is the CT.gov registry default and stays badge-less.
 */
function projectionBadgeFor(marker: Marker): ProjectionBadge {
  if (
    marker.projection === 'primary' &&
    marker.anchor_type &&
    marker.anchor_type !== 'trial'
  ) {
    return 'p';
  }
  return (PROJECTION_VISUAL[marker.projection] ?? PROJECTION_VISUAL.actual).badge;
}

/**
 * Derive the visual descriptor from a marker row. Fill style and the projection
 * badge/opacity are driven by projection (actual = filled + no badge, every
 * projected tier = hollow + tier letter), matching marker.component.ts. Note:
 * MarkerType.fill_style is intentionally NOT forwarded here — the dashboard grid
 * overrides it with projection semantics, and this resolver is the single source
 * of that rule. Never throws when marker_types is absent.
 */
export function resolveMarkerVisual(marker: Marker): MarkerVisual {
  const type = marker.marker_types;
  const projection = PROJECTION_VISUAL[marker.projection] ?? PROJECTION_VISUAL.actual;
  return {
    shape: type?.shape ?? 'circle',
    color: type?.color ?? FALLBACK_COLOR,
    fillStyle: marker.projection === 'actual' ? 'filled' : 'outline',
    innerMark: type?.inner_mark ?? 'none',
    isNle: marker.no_longer_expected,
    projectionBadge: projectionBadgeFor(marker),
    opacity: projection.opacity,
    outlineDash: marker.projection === 'forecasted',
  };
}

/**
 * Fractional glyph geometry shared by the SVG icon components and the PPTX
 * glyph. All values are fractions of the glyph's box size, so each renderer
 * scales to its own coordinate system. Pixel stroke widths live in
 * GLYPH_STROKES below (used by the SVG icons); the PPTX renderer keeps its
 * own pt-based widths (OOXML units).
 *
 * Values mirror the on-screen SVG icons (the visual reference). The PNG
 * export captures the rendered DOM directly and needs no glyph constants.
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
   * Flag banner rect approximation used by the PPTX renderer only (OOXML has
   * no quadratic path here). The SVG icon draws the Bezier banner via
   * flagWidth/flagHeight.
   */
  flagBannerW: 0.7,
  flagBannerH: 0.45,
  /** Triangle vertices (x1,y1,x2,y2,x3,y3). */
  trianglePoints: [0.15, 0.1, 0.9, 0.5, 0.15, 0.9] as const,
  /**
   * Flat-top hexagon vertices (x1,y1..x6,y6), clockwise from the left corner.
   * Horizontal radius 0.46, vertical radius 0.40 (regular hexagon proportions),
   * matching the visual weight of the diamond.
   */
  hexagonPoints: [0.04, 0.5, 0.27, 0.1, 0.73, 0.1, 0.96, 0.5, 0.73, 0.9, 0.27, 0.9] as const,
  /** Diamond 'check' polyline points (x1,y1,x2,y2,x3,y3). */
  checkPoints: [0.32, 0.5, 0.45, 0.65, 0.68, 0.38] as const,
} as const;

/**
 * Stroke widths for the SVG icon components. Values are absolute px
 * regardless of glyph size (SVG stroke-width does not scale with the
 * viewBox). The PPTX renderer keeps its own pt-based widths (OOXML units).
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
  /** Dashed outline pattern for the forecasted tier glyph outline. */
  outlineDashPattern: [3, 2.5] as const,
} as const;
