import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { resolveBrandLogoSrc } from './brand-logo-url';

@Component({
  selector: 'app-brand-logo',
  imports: [NgOptimizedImage],
  template: `
    @if (src(); as url) {
      <img
        [ngSrc]="url"
        [alt]="alt()"
        [width]="width()"
        [height]="height()"
        [class]="imgClass()"
        loading="lazy"
        (error)="failed.set(true)"
      />
    } @else {
      <ng-content />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrandLogoComponent {
  readonly url = input.required<string | null | undefined>();
  readonly alt = input<string>('');
  readonly width = input<number>(20);
  readonly height = input<number>(20);
  readonly imgClass = input<string>('');

  // Re-arms to false whenever the url input changes, so a recycled component
  // (e.g. a virtual-scrolled row) re-attempts the new logo. A network error
  // flips it true, falling through to the projected fallback.
  protected readonly failed = linkedSignal(() => {
    this.url();
    return false;
  });

  protected readonly src = computed(() =>
    this.failed() ? null : resolveBrandLogoSrc(this.url(), environment.brandfetchClientId)
  );
}
