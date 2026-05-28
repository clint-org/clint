import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { environment } from '../../../environments/environment';

// Brandfetch Logo Link asset types, ordered by preference.
// Symbol is the brand mark on its own, icon is the small square version,
// logo is the full wordmark + symbol composition.
const TYPES = ['symbol', 'icon', 'logo'] as const;
type LogoType = (typeof TYPES)[number];

@Component({
  selector: 'app-brand-logo',
  imports: [NgOptimizedImage],
  template: `
    @if (current(); as url) {
      <img
        [ngSrc]="url"
        [alt]="alt()"
        [width]="width()"
        [height]="height()"
        [class]="imgClass()"
        loading="lazy"
        (error)="onError()"
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

  // Index into TYPES; advances on each <img> error. Reaching TYPES.length
  // means every type failed and we render the projected fallback.
  protected readonly level = signal(0);

  protected readonly current = computed(() => {
    const raw = this.url();
    if (!raw) return null;
    if (!raw.includes('cdn.brandfetch.io')) return raw;
    const idx = this.level();
    if (idx >= TYPES.length) return null;
    const domain = extractDomain(raw);
    if (!domain) return raw;
    const type: LogoType = TYPES[idx];
    const c = environment.brandfetchClientId;
    // fallback=404 forces the CDN to return HTTP 404 when an asset type
    // doesn't exist; without it, Brandfetch returns its own generic
    // placeholder with HTTP 200 and the (error)-driven cascade never fires.
    const query = c ? `?c=${c}&fallback=404` : '?fallback=404';
    return `https://cdn.brandfetch.io/${domain}/${type}${query}`;
  });

  protected onError(): void {
    this.level.update((v) => v + 1);
  }
}

// Pulls the brand identifier (domain) out of any stored Brandfetch URL,
// stripping a trailing /logo, /symbol, or /icon plus any query string.
// Returns null if the URL doesn't match a recognised shape.
function extractDomain(url: string): string | null {
  const match = url.match(/cdn\.brandfetch\.io\/([^/?]+)/);
  return match ? match[1] : null;
}
