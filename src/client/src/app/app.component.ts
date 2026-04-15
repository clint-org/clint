import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { Toast } from 'primeng/toast';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ConfirmDialog, Toast],
  template: `
    <div class="h-screen bg-slate-50">
      <router-outlet />
    </div>
    <p-confirmdialog />
    <p-toast position="top-right" />
  `,
})
export class AppComponent {}
