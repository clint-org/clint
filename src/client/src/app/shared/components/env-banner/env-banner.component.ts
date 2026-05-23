import { ChangeDetectionStrategy, Component } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { APP_VERSION } from '../../../../environments/version';

@Component({
  selector: 'app-env-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="stripClass"></div>
    <div [class]="badgeClass">{{ label }} v{{ version }}</div>
  `,
  styles: [
    `
      :host {
        display: contents;
      }
    `,
  ],
})
export class EnvBannerComponent {
  protected readonly version = APP_VERSION;

  protected readonly label = environment.envName === 'local' ? 'LOCAL' : 'DEV';

  protected readonly stripClass =
    environment.envName === 'local'
      ? 'h-[3px] w-full flex-shrink-0 bg-violet-500'
      : 'h-[3px] w-full flex-shrink-0 bg-amber-500';

  protected readonly badgeClass =
    environment.envName === 'local'
      ? 'fixed bottom-3 right-3 z-50 rounded bg-violet-600 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-white opacity-70 hover:opacity-100 transition-opacity'
      : 'fixed bottom-3 right-3 z-50 rounded bg-amber-500 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-amber-950 opacity-70 hover:opacity-100 transition-opacity';
}
