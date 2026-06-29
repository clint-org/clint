import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { ActivatedRoute, ActivatedRouteSnapshot, Router } from '@angular/router';

import { LandscapeStateService } from '../landscape-state.service';
import { LandscapeRead, ReadLink, ReadSegment } from './index';
import { parseReadTextRuns, ReadTextRun } from './read-text-runs';

interface RenderSegment {
  runs: ReadTextRun[];
  link: ReadLink | null;
  /** Accessible action label for the link, e.g. "Filter to Eli Lilly". */
  actionLabel: string;
}

/**
 * Renders the auto-generated competitive READ as safe text runs, turning
 * linkable segments into keyboard-operable buttons that drive existing
 * navigation (shared company filter or the catalysts view). Replaces the prior
 * [innerHTML] rendering on every READ surface.
 *
 * Segment -> destination mapping (declared by the build layer, resolved here):
 *   - company-filter -> sets the shared LandscapeStateService company filter in
 *     place (the idiom the landscape views already use to narrow across views).
 *   - catalysts-view  -> navigates to the space's catalysts view, optionally
 *     pre-setting the company filter the catalysts list reads from.
 *
 * Company names are resolved to ids against the loaded dashboard data; a name
 * with no matching company (or no link at all) renders as plain text.
 */
@Component({
  selector: 'app-competitive-read-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="read-strip">
      @for (seg of renderSegments(); track $index; let last = $last) {
        @if (seg.link) {
          <button
            type="button"
            class="read-segment read-segment--link"
            [attr.aria-label]="seg.actionLabel"
            (click)="activate(seg.link)"
          >
            @for (run of seg.runs; track $index) {
              <span
                [class.read-emph]="run.emphasis === 'strong'"
                [class.read-leader]="run.emphasis === 'leader'"
                >{{ run.text }}</span
              >
            }
          </button>
        } @else {
          <span class="read-segment">
            @for (run of seg.runs; track $index) {
              <span
                [class.read-emph]="run.emphasis === 'strong'"
                [class.read-leader]="run.emphasis === 'leader'"
                >{{ run.text }}</span
              >
            }
          </span>
        }
        @if (!last) {
          <span class="read-separator" aria-hidden="true"> | </span>
        }
      }
    </span>
  `,
  styles: `
    .read-strip {
      font-size: inherit;
      color: inherit;
      line-height: inherit;
    }

    .read-segment {
      color: inherit;
    }

    .read-emph {
      color: var(--slate-800, #1e293b);
      font-weight: 600;
    }

    .read-leader {
      color: var(--brand-600, #0d9488);
      font-weight: 600;
    }

    .read-separator {
      color: var(--slate-300, #cbd5e1);
      margin: 0 0.25rem;
    }

    button.read-segment--link {
      display: inline;
      padding: 0;
      margin: 0;
      border: 0;
      background: none;
      font: inherit;
      color: inherit;
      text-align: left;
      cursor: pointer;
      border-radius: 2px;
      text-underline-offset: 2px;
    }

    button.read-segment--link:hover .read-emph,
    button.read-segment--link:hover .read-leader,
    button.read-segment--link:hover {
      text-decoration: underline;
    }

    button.read-segment--link:focus-visible {
      outline: 2px solid var(--brand-600, #0d9488);
      outline-offset: 2px;
    }
  `,
})
export class CompetitiveReadStripComponent {
  private readonly state = inject(LandscapeStateService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly read = input.required<LandscapeRead>();

  protected readonly renderSegments = computed<RenderSegment[]>(() =>
    this.read().segments.map((seg) => this.toRenderSegment(seg))
  );

  private toRenderSegment(seg: ReadSegment): RenderSegment {
    const runs = parseReadTextRuns(seg.html ?? seg.detail);
    const link = this.resolvableLink(seg.link ?? null);
    return { runs, link, actionLabel: this.actionLabel(link) };
  }

  /** Drop a link whose destination cannot be resolved against loaded data. */
  private resolvableLink(link: ReadLink | null): ReadLink | null {
    if (!link) return null;
    if (link.kind === 'company-filter') {
      return this.companyIdByName(link.companyName) ? link : null;
    }
    // catalysts-view: always reachable; an unresolved company just navigates unfiltered.
    return link;
  }

  private actionLabel(link: ReadLink | null): string {
    if (!link) return '';
    if (link.kind === 'company-filter') return `Filter to ${link.companyName}`;
    if (link.companyName) return `View events for ${link.companyName}`;
    return 'View events in the next 90 days';
  }

  protected activate(link: ReadLink): void {
    if (link.kind === 'company-filter') {
      this.applyCompanyFilter(link.companyName);
      return;
    }
    // catalysts-view: narrow to the named company (if it resolves), leaving any
    // other active filters in place, then navigate to the catalysts list.
    if (link.companyName) this.applyCompanyFilter(link.companyName);
    const catalysts = this.catalystsCommands();
    if (catalysts) void this.router.navigate(catalysts);
  }

  private applyCompanyFilter(name: string): void {
    const id = this.companyIdByName(name);
    if (!id) return;
    this.state.filters.update((f) => ({ ...f, companyIds: [id] }));
  }

  private companyIdByName(name: string): string | null {
    const companies = this.state.rawData()?.companies ?? [];
    return companies.find((c) => c.name === name)?.id ?? null;
  }

  /**
   * Router command array to the current space's future-events view, derived from
   * the route param tree (/t/:tenantId/s/:spaceId/future-events). Returns null if
   * the params are unavailable (the filter is still applied in that case).
   */
  private catalystsCommands(): unknown[] | null {
    let tenantId = '';
    let spaceId = '';
    let snap: ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      if (snap.paramMap.has('tenantId')) tenantId = snap.paramMap.get('tenantId') ?? '';
      if (snap.paramMap.has('spaceId')) spaceId = snap.paramMap.get('spaceId') ?? '';
      snap = snap.parent;
    }
    if (!tenantId || !spaceId) return null;
    return ['/t', tenantId, 's', spaceId, 'future-events'];
  }
}
