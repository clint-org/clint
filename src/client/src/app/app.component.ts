import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { HeaderComponent } from './core/layout/header.component';
import { SupabaseService } from './core/services/supabase.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, ConfirmDialog],
  template: `
    <div class="flex flex-col h-screen bg-slate-50">
      @if (supabase.currentUser()) {
        <app-header />
      }
      <div class="flex-1 min-h-0 overflow-auto">
        <router-outlet />
      </div>
    </div>
    <p-confirmdialog />
  `,
})
export class AppComponent {
  protected readonly supabase = inject(SupabaseService);
}
