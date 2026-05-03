import 'zone.js';
import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { providePrimeNG } from 'primeng/config';
import { bootstrapApplication } from '@angular/platform-browser';
import { createClient } from '@supabase/supabase-js';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { environment } from './environments/environment';
import { buildBrandPreset } from './app/config/primeng-theme';
import { generateBrandScale, pickStopForSurface } from './app/core/util/color-scale';
import { BrandContextService, DEFAULT_BRAND } from './app/core/services/brand-context.service';
import { Brand } from './app/core/models/brand.model';

if (!environment.production) {
  (window as Window & { __WORKER_API_BASE?: string }).__WORKER_API_BASE = 'http://localhost:8787';
}

async function fetchBrand(): Promise<Brand> {
  // Dev-only query-string override: ?wl_kind=agency&wl_id=<uuid> bypasses
  // host-based brand resolution so /admin can be smoke-tested locally where
  // every host is `localhost`. Pass `wl_agency_name` and `wl_agency_logo`
  // alongside `wl_kind=tenant` to also smoke-test the agency-attribution
  // chrome ("Intelligence delivered by {agency}") without needing a real
  // tenant->agency row in the local db. Disabled in production builds.
  if (!environment.production) {
    const params = new URLSearchParams(window.location.search);
    const overrideKind = params.get('wl_kind');
    if (overrideKind === 'agency' || overrideKind === 'super-admin' || overrideKind === 'tenant') {
      const agencyName = params.get('wl_agency_name');
      return {
        ...DEFAULT_BRAND,
        kind: overrideKind,
        id: params.get('wl_id'),
        app_display_name: params.get('wl_name') ?? DEFAULT_BRAND.app_display_name,
        primary_color: params.get('wl_primary') ?? DEFAULT_BRAND.primary_color,
        logo_url: params.get('wl_logo'),
        agency:
          overrideKind === 'tenant' && agencyName
            ? { name: agencyName, logo_url: params.get('wl_agency_logo') }
            : null,
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
  // Surface-aware foreground tokens. Dark surface tokenized to the canonical
  // sidebar/icon-rail bg (#0f172a); light to white. Tenants whose seed has
  // poor contrast against the dark chrome get bumped to a lighter stop so
  // the logo, active markers, and avatar text stay legible.
  root.style.setProperty('--brand-on-dark', scale[pickStopForSurface(scale, '#0f172a')]);
  root.style.setProperty('--brand-on-light', scale[pickStopForSurface(scale, '#ffffff')]);
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
        // Portal every overlay (Select, MultiSelect, DatePicker, AutoComplete,
        // Menu, OverlayPanel...) to <body> so dropdowns escape parent
        // stacking contexts and overflow:hidden ancestors -- otherwise tables
        // and scroll containers clip them.
        overlayOptions: {
          appendTo: 'body',
        },
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

  await bootstrapApplication(AppComponent, mergeApplicationConfig(appConfig, dynamicConfig));
})().catch((err) => console.error('bootstrap failed', err));
