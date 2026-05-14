import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';

import { BrandContextService } from '../../../core/services/brand-context.service';

/**
 * Empty-state placeholder rendered on entity detail pages when no primary
 * intelligence exists yet. Visible to agency members only; clients see
 * nothing in its place. Click emits an `add` event so the host page can
 * open the authoring drawer with the primary anchor pre-set.
 */
@Component({
  selector: 'app-intelligence-empty',
  standalone: true,
  imports: [ButtonModule],
  template: `
    @if (canEdit()) {
      <section
        class="mb-4 rounded-sm border border-dashed border-slate-300 bg-slate-50/40 px-5 py-6"
        aria-label="No primary intelligence yet"
      >
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <h3 class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Primary intelligence
            </h3>
            <p class="mt-1 text-sm text-slate-600">
              No read yet. Capture {{ agencyName() }}'s summary and implications for this
              {{ entityLabel() }}.
            </p>
          </div>
          <p-button
            label="Add primary intelligence"
            icon="fa-solid fa-plus"
            size="small"
            [text]="false"
            (onClick)="add.emit()"
          />
        </div>
      </section>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntelligenceEmptyComponent {
  private readonly brand = inject(BrandContextService);

  readonly canEdit = input<boolean>(false);
  readonly entityLabel = input<string>('entity');

  readonly add = output<void>();

  protected readonly agencyName = computed(() => {
    const b = this.brand.brand();
    if (b.kind === 'tenant') {
      return b.agency?.name ?? b.app_display_name;
    }
    return b.app_display_name;
  });
}
