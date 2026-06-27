/**
 * Source-contract test: ensures no route navigation call sites use the old
 * segment after the Profiles rename (manage -> profiles).
 *
 * The features/manage/ folder is excluded: its import paths and component
 * names are intentionally unchanged. This file is also excluded from the
 * scan to avoid self-referential matches.
 *
 * Pattern 1 (route array element): a bracket or comma followed by optional
 * whitespace then the string literal. Catches router.navigate and routerLink
 * array elements.
 *
 * Pattern 2 (route URL): the specific URL structure used by the app:
 * /s/<id>/profiles-or-manage/. Uses a lookahead for the space-id slot so
 * plain import-path strings that also contain the word are excluded.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const APP = join(__dirname, '../..');

// Self-reference: exclude this spec file and the features/manage/ folder
// (import paths and component names in that folder legitimately contain
// the folder name).
// Only this spec is excluded (it necessarily contains the literal it bans).
// The features/manage/ folder is NOT excluded: its import paths look like
// '../manage/...' / 'features/manage/...' and its selectors like
// 'app-manage-page-shell', none of which are the exact `'manage'` route-segment
// token this guard matches -- but its TEMPLATES do hold real entity-navigation
// arrays that must use 'profiles'. Excluding the folder here is what let the
// rename regression ship (entity links 404'd to /manage/*).
function isExcluded(filePath: string): boolean {
  return filePath.endsWith('no-manage-route-segments.spec.ts');
}

function collectFiles(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectFiles(full, exts));
    } else if (exts.some((e) => full.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

// Matches the exact quoted route segment `'manage'` / `"manage"` anywhere on a
// line. Deliberately NOT anchored to a preceding [ or , -- multi-line route
// arrays put the segment on its own line (e.g. `  'manage',`), and the old
// anchored pattern missed those. The exact-token form does not match import
// paths ('../manage/...'), selectors ('app-manage-...'), persistence keys
// ('manage-trials'), or prose ('manage members'), so no folder exclusion is
// needed.
const ROUTE_SEGMENT_RE = /['"]manage['"]/;

// Matches the route URL structure: /s/<spaceId>/manage/ where spaceId is a
// UUID-like segment. This targets actual navigation URLs, not import paths
// (which look like features/manage/ or ../manage/).
const ROUTE_URL_RE = /\/s\/[^/'"]+\/manage\//;

describe('no-manage-route-segments (rename regression guard)', () => {
  const files = collectFiles(APP, ['.ts', '.html']).filter((f) => !isExcluded(f));

  it('no file contains a quoted manage route-array segment', () => {
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (ROUTE_SEGMENT_RE.test(line)) {
          violations.push(`${relative(APP, file)}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(violations, `Stray 'manage' route segments:\n${violations.join('\n')}`).toEqual([]);
  });

  it('no file contains a /s/<id>/manage/ route URL', () => {
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (ROUTE_URL_RE.test(line)) {
          violations.push(`${relative(APP, file)}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(violations, `Stray /manage/ route URLs:\n${violations.join('\n')}`).toEqual([]);
  });
});
