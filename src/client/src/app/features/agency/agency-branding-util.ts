// Pure helpers for the agency branding form, kept free of Angular imports so
// they can be unit-tested in the Node environment (see agency-branding-util.spec.ts).

import { generateBrandScale } from '../../core/util/color-scale';
import { TEAL_SCALE, type BrandScale } from '../../config/primeng-theme';

// The sentinel address provision_agency writes when an agency is created
// without a contact email (coalesce(p_contact_email, 'unknown@unknown.invalid')).
// It must never surface in the form or be persisted back as a real value.
export const SENTINEL_CONTACT_EMAIL = 'unknown@unknown.invalid';

// Normalizes a stored contact email for display in the form: the sentinel
// placeholder reads as empty so the field shows its placeholder instead of the
// literal invalid address. Trims surrounding whitespace; null/undefined -> ''.
export function displayContactEmail(stored: string | null | undefined): string {
  const value = (stored ?? '').trim();
  return value === SENTINEL_CONTACT_EMAIL ? '' : value;
}

// Normalizes a form contact-email value for persistence: an empty field (or the
// sentinel typed back in) yields '' so the save path never writes the sentinel.
export function normalizeContactEmailForSave(input: string | null | undefined): string {
  const value = (input ?? '').trim();
  return value === SENTINEL_CONTACT_EMAIL ? '' : value;
}

// A render-ready brand scale for the live preview. Wraps generateBrandScale so
// an in-progress / malformed hex (the user is mid-edit) degrades to the default
// teal scale instead of throwing. Accepts values with or without a leading '#'.
export function previewBrandScale(seed: string | null | undefined): BrandScale {
  const raw = (seed ?? '').trim();
  const hex = raw.startsWith('#') ? raw : `#${raw}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return TEAL_SCALE;
  }
  return generateBrandScale(hex);
}

// Chooses a legible foreground for the preview header label/logo drawn on a
// brand tint. Prefers white (matching how the app renders brand-600 buttons);
// falls back to `dark` (the scale's darkest stop) only when white fails the AA
// large-text / non-text contrast bar (3:1) against a light brand tint.
export function readableForeground(background: string, dark: string): string {
  return contrastRatio('#ffffff', background) >= 3 ? '#ffffff' : dark;
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
