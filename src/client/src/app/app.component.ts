import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { Toast } from 'primeng/toast';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ConfirmDialog, Toast],
  template: `
    <div class="app-root-shell bg-slate-50">
      <router-outlet />
    </div>
    <p-confirmdialog />
    <p-toast
      position="top-right"
      [showTransformOptions]="'translateX(100%)'"
      [hideTransformOptions]="'translateX(100%)'"
      [showTransitionOptions]="'250ms cubic-bezier(0.25, 1, 0.5, 1)'"
      [hideTransitionOptions]="'180ms ease-in'"
    />
  `,
  styles: [
    `
      .app-root-shell {
        height: 100vh;
      }
      @media (max-width: 767px) {
        .app-root-shell {
          height: auto;
          min-height: 100vh;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {}
