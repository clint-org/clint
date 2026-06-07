import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ClintLogoComponent } from '../../shared/components/clint-logo.component';
import { PublicFooterComponent } from '../../shared/components/public-footer.component';
import { BrandContextService } from '../../core/services/brand-context.service';

@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [RouterLink, NgOptimizedImage, ClintLogoComponent, PublicFooterComponent],
  template: `
    <div class="flex min-h-screen flex-col bg-slate-50">
      <main class="flex flex-1 items-center justify-center px-6 py-16">
        <div class="flex max-w-md flex-col items-center text-center">
          @if (brand.logoUrl(); as logo) {
            <img
              [ngSrc]="logo"
              [alt]="brand.appDisplayName() + ' logo'"
              width="160"
              height="40"
              class="h-10 w-auto object-contain"
            />
          } @else {
            <app-clint-logo [size]="48" />
          }
          <p class="mt-6 font-mono text-xs uppercase tracking-[0.16em] text-slate-400">Error 404</p>
          <h1 class="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Page not found</h1>
          <p class="mt-2 text-sm text-slate-500">
            The page you are looking for does not exist or has moved.
          </p>
          <div class="mt-6 flex items-center gap-5 text-sm">
            <a routerLink="/" class="text-brand-700 hover:underline">Go home</a>
            <a routerLink="/login" class="text-slate-600 hover:text-slate-900">Sign in</a>
          </div>
        </div>
      </main>
      <app-public-footer />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundComponent {
  protected readonly brand = inject(BrandContextService);
}
