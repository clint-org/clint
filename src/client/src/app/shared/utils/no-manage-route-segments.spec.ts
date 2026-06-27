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
function isExcluded(filePath: string): boolean {
  return (
    filePath.includes('/features/manage/') ||
    filePath.endsWith('no-manage-route-segments.spec.ts')
  );
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

// Matches a route array literal element: [ or , then optional whitespace then
// the quoted string literal manage. Uses a character class without backslash
// escaping the bracket (lint: no-useless-escape).
const ROUTE_SEGMENT_RE = /[[,]\s*['"]manage['"]/;

// Matches the route URL structure: /s/<spaceId>/manage/ where spaceId is a
// UUID-like segment. This targets actual navigation URLs, not import paths
// (which look like features/manage/ or ../manage/).
const ROUTE_URL_RE = /\/s\/[^/'"]+\/manage\//;

describe('no-manage-route-segments (rename regression guard)', () => {
  const files = collectFiles(APP, ['.ts', '.html']).filter((f) => !isExcluded(f));

  it('no file outside features/manage/ contains a manage route-array segment', () => {
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

  it('no file outside features/manage/ contains a /s/<id>/manage/ route URL', () => {
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
