import { Page, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

/**
 * Shared capture plumbing for export tests. saveBlob revokes its object URL
 * immediately, so tests hook URL.createObjectURL and keep both a {type,size}
 * snapshot and the Blob itself for byte-level assertions and artifact dumps.
 */

export const AUDIT_DIR = '/tmp/export-audit';

export interface CapturedBlob {
  type: string;
  size: number;
}

interface BlobCaptureWindow {
  __exportBlobs: CapturedBlob[];
  __exportBlobObjects: Blob[];
  __exportHostSightings: { tag: string; left: number; top: number; width: number }[];
}

/**
 * Must be called before page.goto. Also records every app-*-export-host element
 * attached to <body> and samples its bounding rect each animation frame while
 * attached, so tests can assert the off-screen host never enters the viewport
 * (the "flicker" regression).
 */
export async function installExportCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as BlobCaptureWindow & Window;
    w.__exportBlobs = [];
    w.__exportBlobObjects = [];
    w.__exportHostSightings = [];
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource): string => {
      if (obj instanceof Blob) {
        w.__exportBlobs.push({ type: obj.type, size: obj.size });
        w.__exportBlobObjects.push(obj);
      }
      return orig(obj);
    };

    const watched = new Set<Element>();
    const sample = (el: Element): void => {
      if (!el.isConnected) {
        watched.delete(el);
        return;
      }
      const r = el.getBoundingClientRect();
      // Record only sightings that intersect the viewport: those are the bug.
      if (r.width > 0 && r.right > 0 && r.left < window.innerWidth && r.bottom > 0 && r.top < window.innerHeight) {
        w.__exportHostSightings.push({
          tag: el.tagName.toLowerCase(),
          left: r.left,
          top: r.top,
          width: r.width,
        });
      }
      requestAnimationFrame(() => sample(el));
    };
    // Observe the document node, not documentElement: at init-script time the
    // <html> element is a pre-parse placeholder that gets replaced when the
    // real document arrives, which would orphan the observer silently.
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n instanceof Element && /-export-host$/.test(n.tagName.toLowerCase()) && !watched.has(n)) {
            watched.add(n);
            sample(n);
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

export async function lastBlob(page: Page): Promise<CapturedBlob | null> {
  return page.evaluate(
    () => (window as unknown as BlobCaptureWindow).__exportBlobs.at(-1) ?? null
  );
}

export async function blobCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as BlobCaptureWindow).__exportBlobs.length);
}

/** Sightings of an export host inside the visible viewport (should stay empty). */
export async function visibleHostSightings(
  page: Page
): Promise<{ tag: string; left: number; top: number; width: number }[]> {
  return page.evaluate(
    () => (window as unknown as BlobCaptureWindow).__exportHostSightings
  );
}

/** Write the most recent captured blob to disk and return its byte length. */
export async function saveLastBlob(page: Page, filePath: string): Promise<number> {
  const b64 = await page.evaluate(async () => {
    const w = window as unknown as BlobCaptureWindow;
    const blob = w.__exportBlobObjects.at(-1);
    if (!blob) return null;
    const buf = await blob.arrayBuffer();
    let s = '';
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  });
  if (b64 === null) throw new Error('No captured blob to save');
  mkdirSync(dirname(filePath), { recursive: true });
  const buf = Buffer.from(b64, 'base64');
  writeFileSync(filePath, buf);
  return buf.length;
}

/** Decode the most recent captured PNG blob in-page and return its dimensions. */
export async function lastPngDimensions(
  page: Page
): Promise<{ width: number; height: number }> {
  return page.evaluate(async () => {
    const w = window as unknown as BlobCaptureWindow;
    const blob = w.__exportBlobObjects.at(-1);
    if (!blob) throw new Error('No captured blob');
    const bmp = await createImageBitmap(blob);
    const dims = { width: bmp.width, height: bmp.height };
    bmp.close();
    return dims;
  });
}

/**
 * Click the export trigger and run one export action by its menu label.
 * Single-action surfaces (grids) render a direct button; multi-action surfaces
 * render a menu. Tolerates the legacy timeline dialog by clicking through it.
 */
export async function runExport(page: Page, actionLabel: string | null): Promise<void> {
  const before = await blobCount(page);
  // Accessible names vary by surface: 'Export' (menu trigger), 'Export options',
  // 'Export Excel' (single-action grid button via aria-label).
  await page.getByRole('button', { name: /^Export(\s|$)/ }).first().click();
  if (actionLabel) {
    const item = page.getByRole('menuitem', { name: actionLabel });
    await expect(item).toBeVisible({ timeout: 5000 });
    await item.click();
  }
  // Legacy timeline dialog: confirm if it appears.
  const dialogExport = page.locator('.p-dialog').getByRole('button', { name: 'Export', exact: true });
  try {
    await dialogExport.waitFor({ state: 'visible', timeout: 1500 });
    await dialogExport.click();
  } catch {
    // No dialog: direct export path.
  }
  await expect
    .poll(async () => blobCount(page), { timeout: 30000, message: 'export blob produced' })
    .toBeGreaterThan(before);
}

export function auditPath(name: string): string {
  return join(AUDIT_DIR, name);
}
