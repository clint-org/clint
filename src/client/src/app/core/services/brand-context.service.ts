import { Injectable, computed, signal } from '@angular/core';
import { Brand } from '../models/brand.model';
import { resolveAgencyName, resolveIntelligenceLabel } from '../models/intelligence-label';

export const DEFAULT_BRAND: Brand = {
  kind: 'default',
  id: null,
  app_display_name: 'Clint',
  logo_url: null,
  favicon_url: null,
  primary_color: '#0d9488',
  auth_providers: ['google', 'microsoft'],
  has_self_join: false,
  suspended: false,
  agency: null,
};

@Injectable({ providedIn: 'root' })
export class BrandContextService {
  private readonly _brand = signal<Brand>(DEFAULT_BRAND);

  readonly brand = this._brand.asReadonly();
  readonly kind = computed(() => this._brand().kind);
  readonly appDisplayName = computed(() => this._brand().app_display_name);
  readonly logoUrl = computed(() => this._brand().logo_url);
  readonly faviconUrl = computed(() => this._brand().favicon_url);
  readonly primaryColor = computed(() => this._brand().primary_color);
  readonly authProviders = computed(() => this._brand().auth_providers);
  readonly hasSelfJoin = computed(() => this._brand().has_self_join);
  readonly suspended = computed(() => this._brand().suspended);
  readonly agency = computed(() => this._brand().agency);

  /**
   * Display name of the agency in the current context, or null. Single source
   * of truth for "{Agency} intelligence" framing (see {@link intelligenceLabel}).
   */
  readonly agencyName = computed(() => resolveAgencyName(this._brand()));

  /**
   * Formal label for the authored-brief deliverable: "{Agency} intelligence"
   * when an agency resolves, else plain "Intelligence". Use on formal surfaces
   * (section headers, empty states, authoring drawer title). Compact surfaces
   * (nav, badges, tooltips) and the unified `/intelligence` feed stay plain
   * "Intelligence".
   */
  readonly intelligenceLabel = computed(() => resolveIntelligenceLabel(this._brand()));

  setBrand(brand: Brand): void {
    this._brand.set(brand);
  }
}
