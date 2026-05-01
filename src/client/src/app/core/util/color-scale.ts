import type { BrandScale } from '../../config/primeng-theme';

/**
 * Generate an 11-stop color scale (50..950) from a single hex seed by
 * anchoring the seed at the 600 stop (the dominant "brand color" used by
 * buttons, links, and active states across the app), and deriving the
 * other stops by varying lightness around it in HSL.
 *
 * Why 600: brand-600 is by far the most-referenced stop in the codebase
 * (~3x the next most-used), and the default `TEAL_SCALE.600` (#0d9488)
 * is also Clint's primary color -- so anchoring user seeds there
 * matches what tenants visually expect when they pick a brand color.
 *
 * Saturation tapers at the lightest and darkest stops to keep tints
 * from going candy-colored and darks from going muddy. Mid-tone seeds
 * (lightness 0.30..0.55, saturation 0.40..0.85) produce the best
 * scales; extreme seeds still produce coherent palettes but sacrifice
 * subtlety in the surface tints.
 */
const STOPS: readonly {
  key: keyof BrandScale;
  lDelta: number;
  satCap?: number;
}[] = [
  { key: 50, lDelta: +0.45, satCap: 0.4 },
  { key: 100, lDelta: +0.4, satCap: 0.45 },
  { key: 200, lDelta: +0.32, satCap: 0.55 },
  { key: 300, lDelta: +0.22 },
  { key: 400, lDelta: +0.13 },
  { key: 500, lDelta: +0.06 },
  { key: 600, lDelta: 0.0 }, // seed anchor
  { key: 700, lDelta: -0.07 },
  { key: 800, lDelta: -0.15 },
  { key: 900, lDelta: -0.22, satCap: 0.85 },
  { key: 950, lDelta: -0.3, satCap: 0.75 },
];

export function generateBrandScale(seedHex: string): BrandScale {
  const seed = seedHex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(seed)) {
    throw new Error(`Invalid hex color: ${seedHex}`);
  }
  const r = parseInt(seed.slice(0, 2), 16) / 255;
  const g = parseInt(seed.slice(2, 4), 16) / 255;
  const b = parseInt(seed.slice(4, 6), 16) / 255;
  const [h, s, l] = rgbToHsl(r, g, b);

  const out = {} as BrandScale;
  for (const stop of STOPS) {
    const stopL = clamp(l + stop.lDelta, 0.02, 0.98);
    const stopS = stop.satCap !== undefined ? Math.min(s, stop.satCap) : s;
    out[stop.key] = hslToHex(h, stopS, stopL);
  }
  return out;
}

/**
 * Pick the brand stop that gives the best legibility against a given surface
 * color. Used to derive `--brand-on-dark` / `--brand-on-light` so foreground
 * uses of the brand color stay readable when a tenant picks a seed that
 * collapses into the surface (e.g. a navy seed against the slate-900 sidebar).
 *
 * For a dark surface we prefer 600 and walk lighter (500, 400, ...) until WCAG
 * contrast clears `minRatio`; for a light surface we walk darker (700, 800,
 * ...). 4.5:1 is the AA threshold for normal text and is a safe single bar
 * even for the small UI bits (active markers, avatar initials) that use this
 * token. If nothing clears the bar (extreme seeds), we return whichever stop
 * has the highest contrast so the result is at least the best available.
 */
export function pickStopForSurface(
  scale: BrandScale,
  surfaceHex: string,
  minRatio = 4.5
): keyof BrandScale {
  const surfaceL = relativeLuminance(surfaceHex);
  const preferLighter = surfaceL < 0.5;
  const order: (keyof BrandScale)[] = preferLighter
    ? [600, 500, 400, 300, 200, 100, 50]
    : [600, 700, 800, 900, 950];
  for (const key of order) {
    if (contrastRatio(scale[key], surfaceHex) >= minRatio) {
      return key;
    }
  }
  return order.reduce(
    (best, k) =>
      contrastRatio(scale[k], surfaceHex) > contrastRatio(scale[best], surfaceHex) ? k : best,
    order[0]
  );
}

function relativeLuminance(hex: string): number {
  const seed = hex.replace('#', '');
  const r = parseInt(seed.slice(0, 2), 16) / 255;
  const g = parseInt(seed.slice(2, 4), 16) / 255;
  const b = parseInt(seed.slice(4, 6), 16) / 255;
  const lin = (c: number): number =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return [0, 0, l];
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) {
    h = (g - b) / d + (g < b ? 6 : 0);
  } else if (max === g) {
    h = (b - r) / d + 2;
  } else {
    h = (r - g) / d + 4;
  }
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): string => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
