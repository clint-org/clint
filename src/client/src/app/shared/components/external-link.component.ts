import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Canonical external link for detail panes (ClinicalTrials.gov, source URLs).
 * Brand text, underline on hover, trailing "leaves the app" arrow icon -- a
 * deliberately distinct affordance from internal entity links
 * (`appDetailPanelEntityLink`), which never underline.
 *
 * The label is projected; the icon is always appended:
 *   <app-external-link [href]="url">ClinicalTrials.gov</app-external-link>
 */
@Component({
  selector: 'app-external-link',
  template: `
    <a
      [href]="href()"
      target="_blank"
      rel="noopener noreferrer"
      class="inline-flex items-center gap-1 text-[12px] text-brand-700 hover:text-brand-800 hover:underline"
    >
      <ng-content />
      <i class="fa-solid fa-arrow-up-right-from-square text-[9px]" aria-hidden="true"></i>
    </a>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExternalLinkComponent {
  readonly href = input.required<string>();
}
