/**
 * Single source of truth for the Clint triple-C mark geometry. Consumed by
 * ClintLogoComponent, LoaderComponent, MarkWatermarkComponent,
 * IntelligenceBadgeComponent, the marketing landing, the boot splash (copied
 * inline in index.html by necessity), and the PPTX export footer.
 * Spec: docs/superpowers/specs/2026-06-11-clint-loader-and-brand-presence-design.md
 */
export const CLINT_MARK_VIEWBOX = '0 0 140 140';

export const CLINT_MARK_POINTS = {
  outer: '112,24 24,24 24,116 112,116',
  middle: '96,40 40,40 40,100 96,100',
  inner: '80,56 56,56 56,84 80,84',
} as const;

export interface ClintMarkStrokes {
  outer: number;
  middle: number;
  inner: number;
}

/** Stroke widths tuned per rendered size so the mark stays legible small. */
export function clintMarkStrokes(size: number): ClintMarkStrokes {
  if (size <= 16) return { outer: 7, middle: 9, inner: 11 };
  if (size <= 24) return { outer: 5, middle: 7, inner: 9 };
  if (size <= 32) return { outer: 4, middle: 5.5, inner: 7.5 };
  if (size <= 48) return { outer: 2.5, middle: 3.5, inner: 5 };
  return { outer: 1.5, middle: 2.2, inner: 3 };
}

export interface ClintMarkColors {
  outer: string;
  middle: string;
  inner: string;
}

/**
 * Standalone SVG as a data URI, for rasterization paths that cannot render
 * Angular templates (the PPTX footer loads this through an Image element).
 * strokeSize lets callers rasterize at high resolution while keeping the
 * stroke weight of the intended display size.
 */
export function clintMarkSvgDataUri(
  size: number,
  colors: ClintMarkColors,
  strokeSize: number = size
): string {
  const s = clintMarkStrokes(strokeSize);
  const line = (points: string, stroke: string, width: number): string =>
    `<polyline points="${points}" stroke="${stroke}" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${CLINT_MARK_VIEWBOX}" fill="none">` +
    line(CLINT_MARK_POINTS.outer, colors.outer, s.outer) +
    line(CLINT_MARK_POINTS.middle, colors.middle, s.middle) +
    line(CLINT_MARK_POINTS.inner, colors.inner, s.inner) +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
