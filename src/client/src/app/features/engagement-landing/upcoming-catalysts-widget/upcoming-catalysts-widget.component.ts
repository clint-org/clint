import { Component, computed, input, output } from '@angular/core';

import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { UpcomingCatalyst } from '../engagement-landing.service';

interface CatalystRow {
  marker_id: string;
  title: string;
  day: string;
  weekday: string;
  context: string;
  status: string | null;
}

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Side rail "Next 14 days" widget. Shows up to 5 upcoming markers within 14
 * days of today. Phase 1 of docs/specs/engagement-landing/spec.md. The
 * dataset is supplied by the parent so the widget itself does not depend on
 * any specific RPC.
 */
@Component({
  selector: 'app-upcoming-catalysts-widget',
  standalone: true,
  imports: [SkeletonComponent],
  template: `
    <section class="card" aria-labelledby="upcoming-heading" [attr.aria-busy]="loading() || null">
      <header class="card-head">
        <h2 id="upcoming-heading">Next 14 days</h2>
      </header>
      @if (loading()) {
        <ul class="upcoming" role="list">
          @for (i of skeletonRows; track i) {
            <li>
              <div class="row" aria-hidden="true">
                <span class="udate">
                  <app-skeleton w="32px" h="13px" />
                  <app-skeleton w="22px" h="9px" />
                </span>
                <span class="ubody">
                  <app-skeleton w="80%" h="12.5px" />
                  <app-skeleton w="55%" h="9.5px" />
                </span>
              </div>
            </li>
          }
        </ul>
      } @else if (rows().length === 0) {
        <p class="empty">No catalysts in the next 14 days.</p>
      } @else {
        <ul class="upcoming" role="list">
          @for (row of rows(); track row.marker_id) {
            <li>
              <button
                type="button"
                class="row"
                (click)="rowClick.emit(row.marker_id)"
                [attr.aria-label]="row.title + ' on ' + row.day"
              >
                <span class="udate">
                  <span class="d">{{ row.day }}</span>
                  <span class="w">{{ row.weekday }}</span>
                </span>
                <span class="ubody">
                  <span class="title">{{ row.title }}</span>
                  @if (row.context) {
                    <span class="ctx">{{ row.context }}</span>
                  }
                  @if (row.status) {
                    <span class="ctx ctx-pending">{{ row.status }}</span>
                  }
                </span>
              </button>
            </li>
          }
        </ul>
        @if (allCatalystsRoute()) {
          <a class="section-action-link catalysts-all-link" [href]="allCatalystsRoute()">
            All catalysts
          </a>
        }
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .card {
        background: white;
        border: 1px solid #e2e8f0;
        padding: 16px 18px;
      }
      .card-head {
        padding-bottom: 10px;
        border-bottom: 1px solid #f1f5f9;
        margin-bottom: 12px;
      }
      .card-head h2 {
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 10.5px;
        font-weight: 700;
        color: #334155;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        margin: 0;
      }
      .empty {
        margin: 0;
        font-size: 12px;
        color: #64748b;
        line-height: 1.5;
      }
      .upcoming {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0;
      }
      .upcoming li {
        border-bottom: 1px solid #f1f5f9;
      }
      .upcoming li:last-child {
        border-bottom: 0;
      }
      .row {
        display: grid;
        grid-template-columns: 50px 1fr;
        gap: 10px;
        padding: 10px 0;
        width: 100%;
        background: none;
        border: none;
        cursor: pointer;
        text-align: left;
        align-items: start;
      }
      .row:focus-visible {
        outline: 2px solid var(--brand-600);
        outline-offset: 2px;
        border-radius: 2px;
      }
      .row:hover .title {
        color: var(--brand-700);
      }
      .udate {
        display: flex;
        flex-direction: column;
        gap: 3px;
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
      }
      .udate .d {
        font-size: 13px;
        font-weight: 700;
        color: #0f172a;
        line-height: 1;
      }
      .udate .w {
        font-size: 9px;
        color: #94a3b8;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .ubody {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .title {
        font-size: 12.5px;
        font-weight: 600;
        color: #0f172a;
        line-height: 1.3;
        transition: color 120ms ease-out;
      }
      .ctx {
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 9.5px;
        color: #64748b;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .ctx-pending {
        color: var(--brand-700);
      }
      .catalysts-all-link {
        display: block;
        margin-top: 12px;
        padding-top: 10px;
        border-top: 1px solid #f1f5f9;
      }
    `,
  ],
})
export class UpcomingCatalystsWidgetComponent {
  readonly catalysts = input<UpcomingCatalyst[]>([]);
  readonly limit = input<number>(5);
  readonly loading = input<boolean>(false);
  readonly allCatalystsRoute = input<string>('');
  readonly rowClick = output<string>();

  protected readonly skeletonRows = [0, 1, 2];

  readonly rows = computed<CatalystRow[]>(() => {
    const limit = this.limit();
    return this.catalysts()
      .slice(0, limit)
      .map((c) => {
        const d = new Date(c.event_date + 'T00:00:00');
        const day = `${SHORT_MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}`;
        const weekday = SHORT_DAYS[d.getDay()];
        const ctxParts = [c.company_name?.toUpperCase(), c.product_name].filter(
          (p): p is string => !!p
        );
        const status = c.is_projected ? 'Projected' : null;
        return {
          marker_id: c.marker_id,
          title: c.title || c.category_name || 'Catalyst',
          day,
          weekday,
          context: ctxParts.join(' / '),
          status,
        };
      });
  });
}
