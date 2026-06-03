import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { environment } from '../../../environments/environment';

// Brandfetch Logo Link asset types, ordered by preference. The worker's
// enrichment step normally embeds the right type in the stored URL based
// on Brand API discovery, so the cascade only runs for legacy rows that
// were enriched before that step existed (bare cdn.brandfetch.io/<domain>).
const TYPES = ['symbol', 'icon', 'logo'] as const;
type LogoType = (typeof TYPES)[number];
const TYPE_SEGMENT_RE = /cdn\.brandfetch\.io\/[^/?]+\/(symbol|icon|logo)(\?|$)/;

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

  // 0 = first attempt, 1 = errored once, etc. For type-specific stored URLs
  // a single failure jumps straight past TYPES.length and renders the
  // projected fallback. For legacy bare URLs we cycle through TYPES.
  protected readonly level = signal(0);

  protected readonly current = computed(() => {
    const raw = this.url();
    if (!raw) return null;
    if (!raw.includes('cdn.brandfetch.io')) return raw;
    const c = environment.brandfetchClientId;
    const idx = this.level();

    const typed = raw.match(TYPE_SEGMENT_RE);
    if (typed) {
      if (idx > 0) return null;
      return appendClient(stripQuery(raw), c);
    }

    if (idx >= TYPES.length) return null;
    const domain = extractDomain(raw);
    if (!domain) return raw;
    const type: LogoType = TYPES[idx];
    return appendClient(`https://cdn.brandfetch.io/${domain}/${type}`, c);
  });

  protected onError(): void {
    const raw = this.url();
    if (raw && TYPE_SEGMENT_RE.test(raw)) {
      this.level.set(TYPES.length);
      return;
    }
    this.level.update((v) => v + 1);
  }
}

function stripQuery(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

function appendClient(url: string, clientId: string | undefined): string {
  return clientId ? `${url}?c=${clientId}` : url;
}

// Pulls the brand identifier (domain) out of any stored Brandfetch URL,
// stripping a trailing /logo, /symbol, or /icon plus any query string.
// Returns null if the URL doesn't match a recognised shape.
function extractDomain(url: string): string | null {
  const match = url.match(/cdn\.brandfetch\.io\/([^/?]+)/);
  return match ? match[1] : null;
}
