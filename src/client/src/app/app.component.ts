import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmDialog } from 'primeng/confirmdialog';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ConfirmDialog],
  template: `
    <div class="h-screen bg-slate-50">
      <router-outlet />
    </div>
    <p-confirmdialog />
  `,
})
export class AppComponent {}
