import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './core/layout/header.component';
import { SupabaseService } from './core/services/supabase.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent],
  template: `
    <div class="flex flex-col h-screen">
      @if (supabase.currentUser()) {
        <app-header />
      }
      <div class="flex-1 overflow-hidden">
        <router-outlet />
      </div>
    </div>
  `,
})
export class AppComponent {
  protected readonly supabase = inject(SupabaseService);
}
