import 'zone.js';
import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { providePrimeNG } from 'primeng/config';
import { bootstrapApplication } from '@angular/platform-browser';
import { createClient } from '@supabase/supabase-js';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { environment } from './environments/environment';
import { buildBrandPreset } from './app/config/primeng-theme';
import { generateBrandScale } from './app/core/util/color-scale';
import {
  BrandContextService,
  DEFAULT_BRAND,
} from './app/core/services/brand-context.service';
import { Brand } from './app/core/models/brand.model';

async function fetchBrand(): Promise<Brand> {
  // Dev-only query-string override: ?wl_kind=agency&wl_id=<uuid> bypasses
  // host-based brand resolution so /admin can be smoke-tested locally where
  // every host is `localhost`. Disabled in production builds.
  if (!environment.production) {
    const params = new URLSearchParams(window.location.search);
    const overrideKind = params.get('wl_kind');
    if (overrideKind === 'agency' || overrideKind === 'super-admin' || overrideKind === 'tenant') {
      return {
        ...DEFAULT_BRAND,
        kind: overrideKind,
        id: params.get('wl_id'),
        app_display_name: params.get('wl_name') ?? DEFAULT_BRAND.app_display_name,
      } as Brand;
    }
  }

  try {
    // This pre-bootstrap client only makes one anon RPC call. Disable all
    // auth side effects so it doesn't fight the SupabaseService client over
    // the OAuth callback: detectSessionInUrl=true (default) would race to
    // consume the ?code= fragment on /auth/callback into THIS client's
    // default-localStorage session (key: sb-{ref}-auth-token), leaving the
    // cookie-storage SupabaseService with no session and bouncing the user
    // back to /login.
    const supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const { data, error } = await supabase.rpc('get_brand_by_host', {
      p_host: window.location.host,
    });
    if (error || !data) {
      return DEFAULT_BRAND;
    }
    // Merge RPC payload over defaults so missing fields (e.g. when kind === 'default')
    // don't crash callers that read e.g. brand.app_display_name.
    return { ...DEFAULT_BRAND, ...(data as Partial<Brand>) } as Brand;
  } catch {
    return DEFAULT_BRAND;
  }
}

function applyBrandSideEffects(brand: Brand): void {
  document.title = brand.app_display_name;
  if (brand.favicon_url) {
    let link = document.querySelector<HTMLLinkElement>("link[rel*='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = brand.favicon_url;
  }
  const scale = generateBrandScale(brand.primary_color);
  const root = document.documentElement;
  for (const [key, value] of Object.entries(scale)) {
    root.style.setProperty(`--brand-${key}`, value);
  }
}

(async () => {
  const brand = await fetchBrand();
  applyBrandSideEffects(brand);
  const scale = generateBrandScale(brand.primary_color);

  const dynamicConfig: ApplicationConfig = {
    providers: [
      providePrimeNG({
        theme: {
          preset: buildBrandPreset(scale),
          options: {
            prefix: 'p',
            darkModeSelector: false,
            cssLayer: false,
          },
        },
        ripple: false,
      }),
      {
        provide: BrandContextService,
        useFactory: (): BrandContextService => {
          const svc = new BrandContextService();
          svc.setBrand(brand);
          return svc;
        },
      },
    ],
  };

  await bootstrapApplication(
    AppComponent,
    mergeApplicationConfig(appConfig, dynamicConfig),
  );
})().catch((err) => console.error('bootstrap failed', err));
