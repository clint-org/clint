import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './core/layout/header.component';
import { SupabaseService } from './core/services/supabase.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent],
  template: `
    @if (supabase.currentUser()) {
      <app-header />
    }
    <router-outlet />
  `,
})
export class AppComponent {
  protected readonly supabase = inject(SupabaseService);
}
