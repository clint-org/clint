import type { BrandScale } from '../../config/primeng-theme';

const SCALE_LIGHTNESS = [97, 93, 86, 76, 65, 54, 47, 39, 31, 23, 13];
const SCALE_KEYS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

/**
 * Generate an 11-stop color scale (50..950) from a single hex seed by
 * holding the seed's hue/saturation roughly constant and varying lightness
 * across an approximation of the Tailwind v4 lightness curve.
 *
 * This is intentionally a v1 approximation -- not a 1:1 reproduction of
 * Tailwind's OKLCH algorithm. The output is good enough for a tenant brand
 * primary scale across a UI built around a single hero color.
 */
export function generateBrandScale(seedHex: string): BrandScale {
  const seed = seedHex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(seed)) {
    throw new Error(`Invalid hex color: ${seedHex}`);
  }
  const r = parseInt(seed.slice(0, 2), 16) / 255;
  const g = parseInt(seed.slice(2, 4), 16) / 255;
  const b = parseInt(seed.slice(4, 6), 16) / 255;
  const [h, s] = rgbToHsl(r, g, b);

  const out = {} as BrandScale;
  for (let i = 0; i < SCALE_KEYS.length; i++) {
    const l = SCALE_LIGHTNESS[i] / 100;
    const adjustedSat = i <= 1 ? Math.min(s, 0.4) : i >= 9 ? Math.min(s, 0.7) : s;
    const key = SCALE_KEYS[i] as keyof BrandScale;
    out[key] = hslToHex(h, adjustedSat, l);
  }
  return out;
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
