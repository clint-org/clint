import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <header class="bg-gray-900 text-white shadow-md">
      <div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <a routerLink="/" class="text-lg font-bold tracking-tight">
          Clinical Trial Dashboard
        </a>

        <nav class="flex items-center gap-6">
          <a
            routerLink="/"
            routerLinkActive="text-blue-400"
            [routerLinkActiveOptions]="{ exact: true }"
            class="text-sm font-medium text-gray-300 transition hover:text-white"
          >
            Dashboard
          </a>
          <a
            routerLink="/manage/companies"
            routerLinkActive="text-blue-400"
            class="text-sm font-medium text-gray-300 transition hover:text-white"
          >
            Companies
          </a>
          <a
            routerLink="/manage/products"
            routerLinkActive="text-blue-400"
            class="text-sm font-medium text-gray-300 transition hover:text-white"
          >
            Products
          </a>
          <a
            routerLink="/manage/marker-types"
            routerLinkActive="text-blue-400"
            class="text-sm font-medium text-gray-300 transition hover:text-white"
          >
            Markers
          </a>
          <a
            routerLink="/manage/therapeutic-areas"
            routerLinkActive="text-blue-400"
            class="text-sm font-medium text-gray-300 transition hover:text-white"
          >
            Therapeutic Areas
          </a>
        </nav>

        <div class="flex items-center gap-3">
          @if (user()) {
            <span class="text-sm text-gray-400">
              {{ user()!.email }}
            </span>
          }
          <button
            type="button"
            (click)="onSignOut()"
            class="rounded bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-200 transition hover:bg-gray-600"
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
