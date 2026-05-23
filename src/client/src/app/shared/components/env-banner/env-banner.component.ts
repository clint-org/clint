import { ChangeDetectionStrategy, Component } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { APP_VERSION } from '../../../../environments/version';

@Component({
  selector: 'app-env-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="bannerClass">
      <span>{{ label }}</span>
      <span class="opacity-60">{{ version }}</span>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 24px;
        flex-shrink: 0;
      }
    `,
  ],
})
export class EnvBannerComponent {
  protected readonly version = APP_VERSION;

  protected readonly label = environment.envName === 'local' ? 'Local' : 'Dev';

  protected readonly bannerClass =
    environment.envName === 'local'
      ? 'flex h-6 items-center justify-center gap-3 bg-violet-600 font-mono text-[11px] font-semibold uppercase tracking-widest text-white'
      : 'flex h-6 items-center justify-center gap-3 bg-amber-500 font-mono text-[11px] font-semibold uppercase tracking-widest text-amber-950';
}
