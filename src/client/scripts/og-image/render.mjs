// Renders the OG share banner to a high-DPI PNG using the Chromium that ships
// with @playwright/test. deviceScaleFactor: 2 -> crisp 2400x1260 output that
// share platforms downscale cleanly. Regenerate with `npm run og:image`.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = resolve(here, 'og-image.html');
const outPath = resolve(here, '../../public/og-image.png');

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
});
await page.goto('file://' + htmlPath);
await page.screenshot({ path: outPath });
await browser.close();
console.log('Wrote', outPath);
