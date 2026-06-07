import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BrandContextService } from '../../core/services/brand-context.service';
import { PLATFORM_LEGAL_EMAIL } from '../../core/models/legal-content';

@Component({
  selector: 'app-public-footer',
  standalone: true,
  imports: [RouterLink],
  template: `
    <footer class="border-t border-slate-200 bg-white">
      <div
        class="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-6 py-5 text-xs text-slate-500 sm:flex-row"
      >
        <p>&copy; {{ year }} {{ brand.appDisplayName() }}</p>
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
  protected readonly mailto = `mailto:${PLATFORM_LEGAL_EMAIL}`;
}
