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
  try {
    const supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
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
