/**
 * WCAG contrast helpers for data-colored text on white surfaces.
 *
 * Marker date captions inherit the marker type's color, and marker types
 * are user-definable, so a static palette lookup cannot guarantee AA. For
 * text we keep the hue but walk lightness down until the color clears the
 * 4.5:1 normal-text threshold against white (brand guide: AA is a hard
 * floor, including on data marks).
 */

const AA_NORMAL_TEXT = 4.5;

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast ratio of a hex color against white (1 to 21). */
export function contrastOnWhite(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 1;
  return 1.05 / (relativeLuminance(rgb) + 0.05);
}

/**
 * Return `hex` darkened (same hue, scaled toward black) until it meets the
 * 4.5:1 AA normal-text ratio on white. Colors that already pass are
 * returned unchanged (normalized to #rrggbb). Invalid input falls back to
 * slate-600, which passes.
 */
export function textColorOnWhite(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#475569';
  let [r, g, b] = rgb;
  if (1.05 / (relativeLuminance([r, g, b]) + 0.05) >= AA_NORMAL_TEXT) {
    return rgbToHex(r, g, b);
  }
  // Scale toward black; 24 steps of 5% always terminates and the loop exits
  // as soon as the ratio clears the threshold.
  for (let i = 0; i < 24; i++) {
    r *= 0.95;
    g *= 0.95;
    b *= 0.95;
    if (1.05 / (relativeLuminance([r, g, b]) + 0.05) >= AA_NORMAL_TEXT) break;
  }
  return rgbToHex(r, g, b);
}
