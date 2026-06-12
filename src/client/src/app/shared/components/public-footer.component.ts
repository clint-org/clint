import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BrandContextService } from '../../core/services/brand-context.service';
import { PLATFORM_SUPPORT_EMAIL, PLATFORM_OPERATOR } from '../../core/models/legal-content';
import { ClintLogoComponent } from './clint-logo.component';

@Component({
  selector: 'app-public-footer',
  standalone: true,
  imports: [RouterLink, ClintLogoComponent],
  template: `
    <footer class="border-t border-slate-200 bg-white">
      <div
        class="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-6 py-5 text-xs text-slate-500 sm:flex-row"
      >
        <p class="flex items-center gap-1.5">
          &copy; {{ year }} {{ ownerName() }}
          @if (showPlatform()) {
            <span class="inline-flex items-center gap-1.5 text-slate-400">
              &middot; Powered by
              <app-clint-logo [size]="12" />
              {{ platform }}
            </span>
          }
        </p>
        <nav class="flex items-center gap-5" aria-label="Legal and contact">
          <a routerLink="/privacy" class="hover:text-slate-900">Privacy</a>
          <a routerLink="/terms" class="hover:text-slate-900">Terms</a>
          <a [href]="mailto" class="hover:text-slate-900">Contact</a>
        </nav>
      </div>
    </footer>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicFooterComponent {
  protected readonly brand = inject(BrandContextService);
  protected readonly year = new Date().getFullYear();
  protected readonly mailto = `mailto:${PLATFORM_SUPPORT_EMAIL}`;
  protected readonly platform = PLATFORM_OPERATOR;

  // Copyright owner: the agency where there is one -- an agency-provisioned
  // tenant (brand.agency()) or an agency host itself (appDisplayName). Falls
  // back to the brand's own name for a direct tenant, and to Clint on the
  // apex/default host. The platform (Clint) is always credited via "Powered
  // by", except when the owner already is Clint (avoids "Clint -- Powered by
  // Clint"). The legal documents themselves remain Clint-owned (structure A).
  protected readonly ownerName = computed(() => this.brand.agency()?.name ?? this.brand.appDisplayName());
  protected readonly showPlatform = computed(() => this.ownerName() !== this.platform);
}
