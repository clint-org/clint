import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import {
  ENTITY_TYPE_LABEL,
  IntelligenceEntityType,
  IntelligenceLinkEntityType,
  PiReference,
} from '../../../core/models/primary-intelligence.model';
import { PiMarkComponent } from '../pi-mark/pi-mark.component';

/**
 * Shared primary-intelligence detail-pane block. Renders an owned-PI summary
 * (headline + summary, brand-tinted) and/or a reference list of incoming PI
 * entries with an optional count. Used by the timeline marker pane, the
 * timeline trial pane, the bullseye detail panel, and the heatmap detail panel
 * so the PI reading experience stays identical across surfaces.
 */
@Component({
  selector: 'app-pi-detail-section',
  imports: [PiMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hasOwned()) {
      <div class="rounded-sm border border-brand-200 bg-brand-50 p-3">
        <div class="flex items-start gap-2">
          <app-pi-mark [size]="12" class="mt-0.5" />
          <div class="min-w-0 flex-1">
            <p class="text-[10px] font-semibold uppercase tracking-wider text-brand-700">
              Primary intelligence
            </p>
            <p class="mt-1 text-[13px] font-medium leading-snug text-slate-800">
              {{ headline() }}
            </p>
            @if (summary()) {
              <p class="mt-1 whitespace-pre-line text-[12px] leading-snug text-slate-600">
                {{ summary() }}
              </p>
            }
          </div>
        </div>
      </div>
    }

    @if (countLabel()) {
      <p class="mt-2 text-[11px] font-medium text-brand-700">
        {{ countLabel() }}
      </p>
    }

    @if (references().length > 0) {
      <ul class="mt-1.5 flex flex-col gap-1" role="list">
        @for (ref of references(); track ref.id) {
          <li
            data-pi-reference
            role="button"
            tabindex="0"
            class="flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-sm border border-slate-200 px-2 py-1.5 hover:border-brand-300 hover:bg-brand-50 focus:outline-none focus:ring-1 focus:ring-brand-500"
            (click)="referenceClick.emit(ref)"
            (keydown.enter)="referenceClick.emit(ref)"
            (keydown.space)="referenceClick.emit(ref)"
          >
            <span class="truncate text-[12px] font-medium text-slate-800">{{ ref.headline }}</span>
            <span class="flex items-center gap-1.5 text-[11px] text-slate-400">
              <span
                class="shrink-0 rounded-sm bg-brand-50 px-1 py-px text-[10px] font-medium text-brand-700"
                >{{ label(ref.entity_type) }}</span
              >
              @if (ref.entity_name) {
                <span class="truncate">{{ ref.entity_name }}</span>
              }
            </span>
          </li>
        }
      </ul>
    }
  `,
})
export class PiDetailSectionComponent {
  readonly headline = input<string | null>(null);
  readonly summary = input<string | null>(null);
  readonly references = input<PiReference[]>([]);
  readonly countLabel = input<string | null>(null);
  readonly referenceClick = output<PiReference>();

  protected readonly hasOwned = computed(() => !!this.headline());

  protected label(type: IntelligenceEntityType | IntelligenceLinkEntityType): string {
    return ENTITY_TYPE_LABEL[type] ?? type;
  }
}
