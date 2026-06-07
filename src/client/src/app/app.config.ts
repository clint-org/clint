import { APP_INITIALIZER, ApplicationConfig, inject, provideZonelessChangeDetection } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, withRouterConfig } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { routes } from './app.routes';
import { RpcCache, RpcCacheStats } from './core/services/rpc-cache.service';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: 'always' })),
    provideAnimationsAsync(),
    ConfirmationService,
    MessageService,
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: () => {
        const cache = inject(RpcCache);
        return () => {
          if (typeof window === 'undefined') return;
          const params = new URLSearchParams(window.location.search);
          if (params.get('debug') === 'cache') {
            window.sessionStorage?.setItem('clint:debug:cache', '1');
          }
          const debugFlag = window.sessionStorage?.getItem('clint:debug:cache') === '1';
          if (!environment.production || debugFlag) {
            cache.enableDevStats();
            (window as Window & { __rpcCacheStats?: () => RpcCacheStats }).__rpcCacheStats = () => cache.getDevStats();
          }
        };
      },
    },
  ],
};
