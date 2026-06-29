// Stamp content-hash cache-busters onto the Stout deck's image URLs.
//
// The deck (src/client/public/internal/stout-intro.html) references screenshots
// by stable filename (img/timeline.png, ...). When a refresh overwrites a PNG in
// place, browsers and the CDN can keep serving the cached copy because the URL is
// unchanged. This rewrites each reference to `img/NAME.png?v=<sha256[:10]>` using
// the PNG's current bytes, so a changed image gets a new URL and is fetched
// fresh, while an unchanged image keeps its hash (idempotent -- re-running with no
// image changes writes nothing).
//
// USAGE (from src/client/):
//   node scripts/stamp-deck-cache-busters.mjs
//
// It also runs automatically at the end of capture-deck-shots.mjs, so a normal
// screenshot refresh re-stamps the deck without a separate step. Commit the
// resulting stout-intro.html alongside the changed PNGs.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_INTERNAL = resolve(here, '../public/internal');

// Rewrite every `src="img/NAME.png"` (with or without an existing ?v=) in
// stout-intro.html to carry the current content hash. Returns the number of
// references whose buster changed.
export function stampCacheBusters(internalDir = DEFAULT_INTERNAL) {
  const htmlPath = resolve(internalDir, 'stout-intro.html');
  const html = readFileSync(htmlPath, 'utf8');
  let changed = 0;
  const out = html.replace(
    /(src=")(img\/[A-Za-z0-9._-]+\.png)(?:\?v=[a-f0-9]+)?(")/g,
    (match, pre, file, post) => {
      let buf;
      try {
        buf = readFileSync(resolve(internalDir, file));
      } catch {
        return match; // referenced file missing -- leave it untouched
      }
      const hash = createHash('sha256').update(buf).digest('hex').slice(0, 10);
      const next = `${pre}${file}?v=${hash}${post}`;
      if (next !== match) changed += 1;
      return next;
    }
  );
  if (out !== html) writeFileSync(htmlPath, out);
  return changed;
}

// Run standalone.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const n = stampCacheBusters();
  console.log(`[stamp] updated cache-busters for ${n} image reference(s)`);
}
