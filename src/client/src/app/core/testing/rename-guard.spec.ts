/**
 * Stage 3 IA rename guard (committed, CI-enforced).
 *
 * The event-model cutover + Stage 3 retired the user-facing "catalyst" vocabulary and the
 * standalone marker-types / marker-categories surfaces. This guard fails if any of those
 * retired tokens reappear in a user-facing or navigation context, so a future change cannot
 * silently regress the rename.
 *
 * Scope decisions (deliberately narrow to avoid false positives):
 *   - "events" as a route segment is NOT guarded: `events` is a legitimate data-layer word
 *     (events table, get_events_page_data, EventService, event.model, FeedItem, etc.). The
 *     /events route is de-routed to a redirect; nav was retargeted to /activity.
 *   - Internal identifiers survive and are allowed: TS type names (Catalyst, CatalystDetail,
 *     FlatCatalyst), internal var/method names (flatCatalysts, filteredCatalysts,
 *     upcomingCatalysts), persisted keys (persistenceKey:'catalysts', NAV_ICONS['catalysts'],
 *     the 'go-catalysts' palette command id, key_catalysts_panel field-visibility id). These
 *     are invisible to users; renaming them would only reset saved state. The guard targets
 *     USER-FACING strings + NAVIGATION targets, not identifiers.
 *   - `redirectTo` lines are allowed: redirects FROM the old paths are the intentional
 *     backward-compat aliases.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

// vitest runs with cwd = src/client; walk the app source (skip specs + generated).
function appFiles(dir = 'src/app'): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...appFiles(full));
    } else if (/\.(ts|html)$/.test(entry) && !/\.spec\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = appFiles();

function scan(pred: (line: string, file: string) => boolean): string[] {
  const hits: string[] = [];
  for (const f of FILES) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (pred(line, f)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

describe('Stage 3 IA rename guard', () => {
  it('no "Future Catalysts" user-facing label remains', () => {
    const hits = scan((line) => /Future Catalysts/i.test(line));
    expect(hits, `retired "Future Catalysts" label found:\n${hits.join('\n')}`).toEqual([]);
  });

  it('no "Marker Types" / "Marker Categories" user-facing label remains', () => {
    // The standalone management screens are retired; their nav labels must not appear.
    const hits = scan((line) => /Marker (Types|Categories)/.test(line));
    expect(hits, `retired marker-screen label found:\n${hits.join('\n')}`).toEqual([]);
  });

  it('nothing navigates to a retired route segment (catalysts / marker-types / marker-categories)', () => {
    // Flag routerLink arrays, router.navigate, createUrlTree, and string URLs that target a
    // retired segment. Allow redirectTo (the back-compat alias) and non-navigation identifiers.
    const navContext = /routerLink|\.navigate\(|createUrlTree|navigateByUrl/;
    const quotedSeg = /['"](catalysts|marker-types|marker-categories)['"]/;
    const urlSeg = /\/(catalysts|marker-types|marker-categories)\b/;
    const hits = scan((line) => {
      if (/redirectTo/.test(line)) return false;
      if (navContext.test(line) && quotedSeg.test(line)) return true;
      if (urlSeg.test(line)) return true;
      return false;
    });
    expect(hits, `navigation to a retired route segment found:\n${hits.join('\n')}`).toEqual([]);
  });

  it('app.routes.ts exposes the retired paths only as redirects, never as live loadComponent routes', () => {
    const routes = readFileSync('src/app/app.routes.ts', 'utf8').split('\n');
    const offenders: string[] = [];
    routes.forEach((line, i) => {
      const m = /path:\s*['"](catalysts|marker-types|marker-categories)['"]/.exec(line);
      if (!m) return;
      // the same route object must declare a redirectTo within the next few lines
      const window = routes.slice(i, i + 4).join(' ');
      if (!/redirectTo/.test(window)) offenders.push(`app.routes.ts:${i + 1}: ${line.trim()}`);
    });
    expect(offenders, `retired path is a live route, not a redirect:\n${offenders.join('\n')}`).toEqual([]);
  });
});
