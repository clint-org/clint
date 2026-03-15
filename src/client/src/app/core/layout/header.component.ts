import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <header class="bg-white border-b border-slate-200">
      <div class="h-0.5 bg-teal-500"></div>
      <div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <a routerLink="/" class="text-base font-semibold text-slate-900 tracking-tight">
          Clinical Trial Dashboard
        </a>

        <nav class="flex items-center gap-6">
          <a
            routerLink="/"
            routerLinkActive="text-slate-900 font-medium border-b-2 border-teal-500 pb-px"
            [routerLinkActiveOptions]="{ exact: true }"
            class="text-sm text-slate-500 transition hover:text-slate-900"
          >
            Dashboard
          </a>
          <a
            routerLink="/manage/companies"
            routerLinkActive="text-slate-900 font-medium border-b-2 border-teal-500 pb-px"
            class="text-sm text-slate-500 transition hover:text-slate-900"
          >
            Companies
          </a>
          <a
            routerLink="/manage/products"
            routerLinkActive="text-slate-900 font-medium border-b-2 border-teal-500 pb-px"
            class="text-sm text-slate-500 transition hover:text-slate-900"
          >
            Products
          </a>
          <a
            routerLink="/manage/marker-types"
            routerLinkActive="text-slate-900 font-medium border-b-2 border-teal-500 pb-px"
            class="text-sm text-slate-500 transition hover:text-slate-900"
          >
            Markers
          </a>
          <a
            routerLink="/manage/therapeutic-areas"
            routerLinkActive="text-slate-900 font-medium border-b-2 border-teal-500 pb-px"
            class="text-sm text-slate-500 transition hover:text-slate-900"
          >
            Therapeutic Areas
          </a>
        </nav>

        <div class="flex items-center gap-3">
          @if (user()) {
            <span class="text-xs text-slate-400">
              {{ user()!.email }}
            </span>
          }
          <button
            type="button"
            (click)="onSignOut()"
            class="text-xs text-slate-400 transition hover:text-slate-600"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  `,
})
export class HeaderComponent {
  private readonly supabase = inject(SupabaseService);

  readonly user = this.supabase.currentUser;

  onSignOut(): void {
    this.supabase.signOut();
  }
}
