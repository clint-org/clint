import { Component, computed, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';

import { CatalystDetail } from '../../core/models/catalyst.model';

@Component({
  selector: 'app-marker-detail-content',
  standalone: true,
  imports: [DatePipe],
  template: `
    @if (detail(); as d) {
      <!-- Title -->
      <h2 class="mb-3 text-sm font-semibold leading-snug text-slate-900">
        {{ d.catalyst.title }}
      </h2>

      <!-- Projection / no longer expected badges -->
      @if (projectionLabel()) {
        <div class="mb-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5">
          <span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
          <span class="text-[10px] font-medium text-amber-700">{{ projectionLabel() }}</span>
        </div>
      }
      @if (d.catalyst.no_longer_expected) {
        <div class="mb-2 ml-1 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5">
          <span class="h-1.5 w-1.5 rounded-full bg-slate-400"></span>
          <span class="text-[10px] font-medium text-slate-500">No longer expected</span>
        </div>
      }

      <!-- Program -->
      @if (d.catalyst.company_name) {
        <div class="mb-3 border-b border-slate-100 pb-2">
          <p class="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Program
          </p>
          <div class="flex items-center gap-2 text-xs text-slate-900">
            @if (d.catalyst.company_logo_url) {
              <img
                [src]="d.catalyst.company_logo_url"
                [alt]="d.catalyst.company_name"
                class="h-5 w-5 rounded object-contain flex-none"
              />
            }
            <p>
              <span class="font-semibold uppercase">{{ d.catalyst.company_name }}</span>
              @if (d.catalyst.product_name) {
                &middot; {{ d.catalyst.product_name }}
              }
            </p>
          </div>
        </div>
      }

      <!-- Trial -->
      @if (d.catalyst.trial_name) {
        <div class="mb-3 border-b border-slate-100 pb-2">
          <p class="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Trial
          </p>
          <p class="text-xs font-medium text-slate-900">
            {{ d.catalyst.trial_name }}
          </p>
          <p class="text-[11px] text-slate-500">
            {{ d.catalyst.trial_phase }}
            @if (d.catalyst.recruitment_status) {
              &middot; {{ d.catalyst.recruitment_status }}
            }
          </p>
        </div>
      }

      <!-- Date & Status -->
      <div class="mb-4 flex items-center gap-4 text-xs text-slate-500">
        <div>
          <span class="font-semibold">Date</span><br />
          {{ d.catalyst.event_date | date: 'mediumDate' }}
        </div>
        <div>
          <span class="font-semibold">Status</span><br />
          @if (d.catalyst.is_projected) {
            <span class="text-amber-600">Projected</span>
          } @else {
            <span class="text-green-600">Confirmed</span>
          }
        </div>
      </div>

      <!-- Description -->
      @if (d.catalyst.description) {
        <div class="mb-4">
          <p class="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Description
          </p>
          <p class="text-xs leading-relaxed text-slate-600">
            {{ d.catalyst.description }}
          </p>
        </div>
      }

      <!-- Source -->
      @if (d.catalyst.source_url) {
        <div class="mb-4">
          <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Source
          </p>
          <a
            [href]="d.catalyst.source_url"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-xs text-brand-700 hover:text-brand-800 hover:underline"
          >
            {{ extractDomain(d.catalyst.source_url) }}
            <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
          </a>
        </div>
      }

      <!-- Upcoming for this trial -->
      @if (d.upcoming_markers.length > 0) {
        <div class="mb-4">
          <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Upcoming for this trial
          </p>
          <ul class="space-y-1">
            @for (um of d.upcoming_markers; track um.marker_id) {
              <li
                class="cursor-pointer border-b border-slate-100 py-1.5 text-[11px] text-slate-600 hover:text-brand-700"
                (click)="markerClick.emit(um.marker_id)"
                (keydown.enter)="markerClick.emit(um.marker_id)"
                tabindex="0"
                role="button"
              >
                {{ um.event_date | date: 'MMM yyyy' }} &middot;
                {{ um.marker_type_name }}
                @if (um.is_projected) {
                  <span class="text-amber-500">(projected)</span>
                }
              </li>
            }
          </ul>
        </div>
      }

      <!-- Related events -->
      @if (d.related_events.length > 0) {
        <div class="mb-4">
          <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Related events
          </p>
          <ul class="space-y-1">
            @for (re of d.related_events; track re.event_id) {
              <li class="text-[11px] text-slate-500">
                {{ re.event_date | date: 'mediumDate' }} &mdash; {{ re.title }}
                <span class="text-slate-500">({{ re.category_name }})</span>
              </li>
            }
          </ul>
        </div>
      }
    }
  `,
})
export class MarkerDetailContentComponent {
  readonly detail = input<CatalystDetail | null>(null);
  readonly markerClick = output<string>();

  protected projectionLabel = computed(() => {
    const d = this.detail();
    if (!d) return '';
    switch (d.catalyst.projection) {
      case 'stout':
        return 'Stout estimate';
      case 'company':
        return 'Company guidance';
      case 'primary':
        return 'Primary source estimate';
      case 'actual':
      default:
        return '';
    }
  });

  protected extractDomain(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }
}
