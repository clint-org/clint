import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Focal projected-vs-confirmed band for detail panes. The single most important
 * data-quality signal on a marker is whether its date is confirmed or an
 * estimate, so it gets a full-width banded row rather than an inline pill.
 *
 * Tone is fixed by meaning, not brand: PROJECTED is always amber (the fixed
 * projection treatment, never whitelabeled); CONFIRMED uses the brand accent
 * (the design system's success role is brand, not green -- green is reserved for
 * data markers). The date is passed pre-formatted by the host.
 */
@Component({
  selector: 'app-detail-panel-status-band',
  standalone: true,
  template: `
    <div
      class="flex items-center gap-3 border-l-[3px] px-3.5 py-2.5"
      [class.bg-amber-50]="projected()"
      [class.border-amber-300]="projected()"
      [class.bg-brand-50]="!projected()"
      [class.border-brand-300]="!projected()"
    >
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span
            class="h-2 w-2 shrink-0 rounded-full border-[1.5px] box-border"
            [class.border-amber-500]="projected()"
            [class.border-brand-600]="!projected()"
            [class.bg-transparent]="projected()"
            [class.bg-brand-600]="!projected()"
          ></span>
          <span
            class="font-mono text-[11px] font-bold uppercase tracking-[0.12em]"
            [class.text-amber-800]="projected()"
            [class.text-brand-700]="!projected()"
          >
            {{ label() }}
          </span>
        </div>
        @if (source()) {
          <div
            class="ml-4 mt-1 text-[11px]"
            [class.text-amber-800]="projected()"
            [class.text-brand-700]="!projected()"
          >
            <span class="opacity-80">Source · {{ source() }}</span>
          </div>
        }
      </div>
      <span
        class="shrink-0 font-mono text-[13px] font-bold tabular-nums"
        [class.text-amber-800]="projected()"
        [class.text-brand-700]="!projected()"
      >
        {{ date() }}
      </span>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailPanelStatusBandComponent {
  /** True for a projected/estimated date, false for a confirmed/actual one. */
  readonly projected = input.required<boolean>();
  /** Pre-formatted event date string. */
  readonly date = input.required<string>();
  /** Optional provenance line, e.g. "Company guidance" or "ClinicalTrials.gov". */
  readonly source = input<string | null>(null);
  /** Optional label override; defaults to Projected / Confirmed. */
  readonly labelOverride = input<string | null>(null);

  protected readonly label = computed(
    () => this.labelOverride() ?? (this.projected() ? 'Projected' : 'Confirmed')
  );
}
