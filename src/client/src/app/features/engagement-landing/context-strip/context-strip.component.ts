import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { SpaceLandingStats } from '../engagement-landing.service';

interface Stat {
  label: string;
  value: string | null;
  route: string | null;
}

export interface ContextStripRoutes {
  activeTrials?: string;
  companies?: string;
  programs?: string;
  catalysts?: string;
  intelligence?: string;
}

/**
 * Engagement context strip: title, subline, and five header stats.
 * Phase 1 of docs/specs/engagement-landing/spec.md.
 */
@Component({
  selector: 'app-engagement-context-strip',
  standalone: true,
  imports: [SkeletonComponent, RouterLink],
  template: `
    <div class="strip">
      <div class="left">
        <h1 class="title">{{ spaceName() || 'Engagement' }}</h1>
        @if (subline()) {
          <p class="subline">{{ subline() }}</p>
        }
      </div>
      <ul class="stats" role="list" aria-label="Engagement statistics">
        @for (stat of computedStats(); track stat.label) {
          <li [attr.aria-busy]="stat.value === null ? true : null">
            @if (stat.route && stat.value !== null) {
              <a
                class="stat stat--link"
                [routerLink]="stat.route"
                [attr.aria-label]="stat.label + ': ' + stat.value"
              >
                <span class="stat-value">{{ stat.value }}</span>
                <span class="stat-label">{{ stat.label }}</span>
              </a>
            } @else {
              <div class="stat">
                @if (stat.value === null) {
                  <span class="stat-value stat-value--loading">
                    <app-skeleton w="36px" h="20px" />
                  </span>
                } @else {
                  <span class="stat-value">{{ stat.value }}</span>
                }
                <span class="stat-label">{{ stat.label }}</span>
              </div>
            }
          </li>
        }
      </ul>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        background: white;
        border-bottom: 1px solid #e2e8f0;
      }
      .strip {
        max-width: 1380px;
        margin: 0 auto;
        padding: 18px 32px;
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 32px;
        flex-wrap: wrap;
      }
      .left {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      .title {
        font-size: 22px;
        font-weight: 700;
        color: #0f172a;
        letter-spacing: -0.005em;
        line-height: 1.2;
        margin: 0;
      }
      .subline {
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 11px;
        color: #64748b;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin: 0;
      }
      .stats {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        gap: 28px;
        flex-wrap: wrap;
      }
      .stat {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 80px;
      }
      a.stat.stat--link {
        text-decoration: none;
        color: inherit;
        outline: none;
        transition:
          color 120ms ease,
          background-color 120ms ease;
        padding: 2px 0;
        margin: -2px 0;
      }
      a.stat.stat--link .stat-value {
        transition: color 120ms ease;
      }
      a.stat.stat--link:hover .stat-value,
      a.stat.stat--link:focus-visible .stat-value {
        color: var(--brand-700, #0f766e);
      }
      a.stat.stat--link:hover .stat-label,
      a.stat.stat--link:focus-visible .stat-label {
        color: var(--brand-700, #0f766e);
      }
      a.stat.stat--link:focus-visible {
        box-shadow: 0 0 0 2px var(--brand-200, #99f6e4);
        border-radius: 2px;
      }
      .stat-value {
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 22px;
        font-weight: 700;
        color: #0f172a;
        letter-spacing: -0.01em;
        line-height: 1;
      }
      .stat-value--loading {
        display: inline-flex;
        align-items: center;
        height: 22px;
      }
      .stat-label {
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 10px;
        color: #64748b;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      @media (max-width: 767px) {
        .strip {
          padding: 16px 16px;
        }
        .stats {
          gap: 18px;
        }
        .title {
          font-size: 20px;
        }
        .stat-value {
          font-size: 18px;
        }
      }
    `,
  ],
})
export class EngagementContextStripComponent {
  readonly spaceName = input<string>('');
  readonly activeSinceLabel = input<string>('');
  readonly stats = input<SpaceLandingStats | null>(null);
  readonly loading = input<boolean>(false);
  readonly routes = input<ContextStripRoutes>({});

  readonly subline = computed(() => {
    const since = this.activeSinceLabel();
    return since ? `Active since ${since}` : '';
  });

  readonly computedStats = computed<Stat[]>(() => {
    const s = this.stats();
    const loading = this.loading();
    const r = this.routes();
    const fmt = (n: number | undefined): string | null => {
      if (loading && !s) return null;
      return typeof n === 'number' ? String(n) : '-';
    };
    return [
      { label: 'Active trials', value: fmt(s?.active_trials), route: r.activeTrials ?? null },
      { label: 'Companies', value: fmt(s?.companies), route: r.companies ?? null },
      { label: 'Programs', value: fmt(s?.programs), route: r.programs ?? null },
      { label: 'Catalysts < 90d', value: fmt(s?.catalysts_90d), route: r.catalysts ?? null },
      { label: 'Intelligence', value: fmt(s?.intelligence_total), route: r.intelligence ?? null },
    ];
  });
}
