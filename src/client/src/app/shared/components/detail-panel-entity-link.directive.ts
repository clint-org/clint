import { Directive, input } from '@angular/core';

/**
 * Canonical inline entity link for detail panes. Apply to an inline anchor
 * (typically an `<a [routerLink]>`) that navigates to a company / asset /
 * trial record.
 *
 * Owns the one true color treatment: slate text that shifts to brand on
 * hover, never underlined. The trailing arrow affordance is intentionally
 * NOT here -- it belongs to standalone full-width navigation rows
 * (`app-detail-panel-entity-row`), not inline links that share a text line.
 *
 *   tone `primary` (default): slate-900, for a labeled section (Trial, Asset).
 *   tone `muted`: slate-500, for an inline link inside a muted meta strip.
 *
 * Company names additionally take `font-semibold uppercase` as plain static
 * classes on the element (brand-guide structural label); those merge with
 * this directive's color classes.
 */
@Directive({
  selector: '[appDetailPanelEntityLink]',
  host: {
    class: 'hover:text-brand-700',
    '[class.text-slate-900]': 'entityLinkTone() === "primary"',
    '[class.text-slate-500]': 'entityLinkTone() === "muted"',
  },
})
export class DetailPanelEntityLinkDirective {
  readonly entityLinkTone = input<'primary' | 'muted'>('primary');
}
