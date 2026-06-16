import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { ColorPicker } from 'primeng/colorpicker';
import { MessageModule } from 'primeng/message';
import { MessageService } from 'primeng/api';

import { AgencyService } from '../../core/services/agency.service';
import { Agency, AgencyBrandingUpdate, BrandfetchResult } from '../../core/models/agency.model';
import { BrandContextService } from '../../core/services/brand-context.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { BrandLogoComponent } from '../../shared/components/brand-logo.component';
import {
  displayContactEmail,
  normalizeContactEmailForSave,
  previewBrandScale,
  readableForeground,
} from './agency-branding-util';

@Component({
  selector: 'app-agency-branding',
  standalone: true,
  imports: [
    NgOptimizedImage,
    FormsModule,
    ButtonModule,
    InputText,
    ColorPicker,
    MessageModule,
    ManagePageShellComponent,
    BrandLogoComponent,
  ],
  template: `
    <app-manage-page-shell>
      <div class="mb-6">
        <h1 class="text-base font-semibold text-slate-900">Agency branding</h1>
        <p class="mt-1 text-xs text-slate-500">
          Branding for the agency-facing portal. Tenant branding is configured per-tenant.
        </p>
      </div>

      @if (loadError()) {
        <p-message
          severity="error"
          [closable]="true"
          (onClose)="loadError.set(null)"
          styleClass="mb-4"
        >
          {{ loadError() }}
        </p-message>
      }

      @if (agency(); as a) {
        <div class="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div>
        <div class="mb-6 rounded border border-slate-200 bg-slate-50 px-4 py-3">
          <label
            for="brandfetch-domain"
            class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
          >
            Auto-fill from domain
          </label>
          <div class="flex items-center gap-2">
            <input
              pInputText
              id="brandfetch-domain"
              class="flex-1 font-mono text-xs"
              [ngModel]="fetchDomain()"
              (ngModelChange)="fetchDomain.set($event)"
              name="fetchDomain"
              placeholder="e.g. pfizer.com"
              (keydown.enter)="onFetchBrand()"
            />
            <p-button
              label="Fetch brand"
              size="small"
              [outlined]="true"
              [loading]="fetching()"
              [disabled]="!fetchDomain().trim() || fetching()"
              (onClick)="onFetchBrand()"
            />
          </div>
          @if (fetchError()) {
            <p class="mt-1.5 text-[11px] text-red-600">{{ fetchError() }}</p>
          }
          @if (fetchPreview(); as preview) {
            <div class="mt-3 flex items-start gap-3 rounded border border-slate-200 bg-white p-3">
              @if (preview.logo_url) {
                <img
                  [ngSrc]="preview.logo_url!"
                  alt="Fetched logo"
                  width="120"
                  height="40"
                  class="h-10 w-auto max-w-[120px] object-contain"
                />
              }
              <div class="flex-1 text-xs text-slate-600">
                @if (preview.name) {
                  <p class="font-medium text-slate-900">{{ preview.name }}</p>
                }
                @if (preview.primary_color) {
                  <div class="mt-1 flex items-center gap-1.5">
                    <span
                      class="inline-block h-3 w-3 rounded-sm border border-slate-300"
                      [style.background-color]="preview.primary_color"
                    ></span>
                    <span class="font-mono text-[10px] uppercase text-slate-400">{{ preview.primary_color }}</span>
                  </div>
                }
              </div>
              <p-button
                label="Apply"
                size="small"
                (onClick)="applyFetchedBrand()"
              />
            </div>
          }
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="sm:col-span-2">
            <label
              for="agency-display-name"
              class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            >
              App display name
            </label>
            <input
              pInputText
              id="agency-display-name"
              class="w-full"
              [ngModel]="appDisplayName()"
              (ngModelChange)="appDisplayName.set($event)"
              name="appDisplayName"
            />
          </div>

          <div>
            <label
              for="agency-primary"
              class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            >
              Primary color
            </label>
            <div class="flex items-center gap-2">
              <p-colorpicker
                [ngModel]="primaryColorRaw()"
                (ngModelChange)="onPrimaryColorRawChange($event)"
                name="primary"
              />
              <input
                pInputText
                id="agency-primary"
                class="flex-1 font-mono text-xs"
                [ngModel]="primaryColorHash()"
                (ngModelChange)="primaryColorHash.set($event)"
                name="primaryText"
                maxlength="7"
              />
            </div>
          </div>

          <div class="sm:col-span-2">
            <label
              for="agency-logo"
              class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            >
              Logo URL
            </label>
            <input
              pInputText
              id="agency-logo"
              class="w-full"
              [ngModel]="logoUrl()"
              (ngModelChange)="logoUrl.set($event)"
              name="logoUrl"
              placeholder="https://..."
            />
          </div>

          <div class="sm:col-span-2">
            <label
              for="agency-contact"
              class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            >
              Contact email
            </label>
            <input
              pInputText
              id="agency-contact"
              type="email"
              class="w-full"
              [ngModel]="contactEmail()"
              (ngModelChange)="contactEmail.set($event)"
              name="contactEmail"
              placeholder="contact@youragency.com"
            />
          </div>

          <div class="sm:col-span-2">
            <label
              for="agency-email-domain"
              class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            >
              Member email domain (lock)
            </label>
            <input
              pInputText
              id="agency-email-domain"
              class="w-full font-mono text-xs"
              [ngModel]="emailDomain()"
              (ngModelChange)="emailDomain.set($event)"
              name="emailDomain"
              placeholder="e.g. acme.com"
            />
            <p class="mt-1 text-[11px] text-slate-500">
              When set, every agency member and every tenant owner under this agency must have an
              email on this domain. Leave blank to allow any domain. Editing this does NOT remove
              existing members; it only gates future additions.
            </p>
          </div>
        </div>

        <div class="mt-6 flex items-center gap-3 pt-4 border-t border-slate-200">
          <p-button
            label="Save"
            size="small"
            [loading]="saving()"
            [disabled]="!hasChanges() || saving()"
            (onClick)="onSave()"
          />
          @if (saveError()) {
            <span class="text-xs text-red-600">{{ saveError() }}</span>
          }
        </div>

        <div class="mt-10 border-t border-slate-200 pt-6 text-xs text-slate-500">
          <h2 class="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Identity
          </h2>
          <dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 font-mono text-[11px]">
            <dt class="text-slate-400">Slug</dt>
            <dd>{{ a.slug }}</dd>
            <dt class="text-slate-400">Subdomain</dt>
            <dd>{{ a.subdomain }}</dd>
            <dt class="text-slate-400">Plan</dt>
            <dd>{{ a.plan_tier }}</dd>
            <dt class="text-slate-400">Tenant limit</dt>
            <dd>{{ a.max_tenants }}</dd>
            @if (a.custom_domain) {
              <dt class="text-slate-400">Custom domain</dt>
              <dd>{{ a.custom_domain }}</dd>
            }
          </dl>
        </div>
        </div>

        <div class="lg:sticky lg:top-6 lg:self-start">
          <h2 class="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Live preview
          </h2>
          <p class="mb-3 text-[11px] text-slate-500">
            How the agency portal applies the brand color and logo above. Updates as you edit.
          </p>

          <div class="overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
            <!-- Tinted header bar. The background is the agency's chosen brand
                 color (the value being edited), so an inline style binding is the
                 correct mechanism for this dynamic, user-controlled CSS color. -->
            <div
              class="flex items-center gap-2.5 px-4 py-3"
              [style.background-color]="previewHeaderBg()"
            >
              <app-brand-logo
                [url]="previewLogoUrl()"
                [alt]="previewName() + ' logo'"
                [width]="22"
                [height]="22"
                imgClass="h-[22px] w-auto max-w-[120px] object-contain"
              >
                <span
                  class="grid h-[22px] w-[22px] place-items-center rounded-sm text-[11px] font-semibold"
                  [style.background-color]="previewMarkBg()"
                  [style.color]="previewHeaderFg()"
                >
                  {{ previewInitial() }}
                </span>
              </app-brand-logo>
              <span
                class="truncate text-[13px] font-semibold tracking-tight"
                [style.color]="previewHeaderFg()"
              >
                {{ previewName() }}
              </span>
            </div>

            <div class="space-y-3 px-4 py-4">
              <p class="text-xs text-slate-500">
                Active states, links, and primary actions use the brand color.
              </p>
              <button
                type="button"
                tabindex="-1"
                aria-hidden="true"
                class="inline-flex cursor-default items-center rounded-none px-3 py-1.5 text-[12px] font-medium"
                [style.background-color]="previewButtonBg()"
                [style.color]="previewHeaderFg()"
              >
                Primary action
              </button>
              <div class="flex items-center gap-1.5 pt-1">
                <span
                  class="inline-block h-3 w-3 rounded-sm border border-slate-300"
                  [style.background-color]="previewSwatch()"
                ></span>
                <span class="font-mono text-[10px] uppercase text-slate-400">{{
                  previewSwatch()
                }}</span>
              </div>
            </div>
          </div>
        </div>
        </div>
      }
    </app-manage-page-shell>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgencyBrandingComponent implements OnInit {
  private readonly agencyService = inject(AgencyService);
  private readonly messageService = inject(MessageService);
  private readonly brand = inject(BrandContextService);

  readonly agency = signal<Agency | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);
  readonly saving = signal(false);

  readonly appDisplayName = signal('');
  readonly contactEmail = signal('');
  readonly logoUrl = signal('');
  readonly emailDomain = signal('');
  readonly primaryColorHash = signal('#0d9488');
  readonly primaryColorRaw = computed(() => this.primaryColorHash().replace(/^#/, ''));

  readonly fetchDomain = signal('');
  readonly fetching = signal(false);
  readonly fetchError = signal<string | null>(null);
  readonly fetchPreview = signal<BrandfetchResult | null>(null);

  // Live brand preview. Derived purely from the form signals above, so editing
  // the primary color or logo URL recomputes the preview immediately.
  private readonly previewScale = computed(() => previewBrandScale(this.primaryColorHash()));
  protected readonly previewHeaderBg = computed(() => this.previewScale()[600]);
  protected readonly previewButtonBg = computed(() => this.previewScale()[600]);
  protected readonly previewSwatch = computed(() => this.previewScale()[600]);
  // White stays legible on most brand-600 tints; for a light seed where it would
  // fail AA, drop to the scale's darkest stop instead.
  protected readonly previewHeaderFg = computed(() => {
    const scale = this.previewScale();
    return readableForeground(scale[600], scale[950]);
  });
  protected readonly previewMarkBg = computed(() => this.previewScale()[700]);
  protected readonly previewLogoUrl = computed(() => this.logoUrl().trim() || null);
  protected readonly previewName = computed(
    () => this.appDisplayName().trim() || this.agency()?.name || 'Agency'
  );
  protected readonly previewInitial = computed(
    () => (this.previewName().trim()[0] || 'A').toUpperCase()
  );

  onPrimaryColorRawChange(raw: string): void {
    const stripped = (raw || '').replace(/^#/, '').toLowerCase();
    this.primaryColorHash.set(stripped ? `#${stripped}` : '');
  }

  readonly hasChanges = computed(() => {
    const a = this.agency();
    if (!a) return false;
    const primary = '#' + this.primaryColorHash().replace(/^#/, '').toLowerCase();
    const domain = (this.emailDomain() || '').trim().toLowerCase() || null;
    // Compare normalized-to-normalized so the sentinel (treated as empty in the
    // form) does not register as a pending change against the stored sentinel.
    const contact = normalizeContactEmailForSave(this.contactEmail());
    const storedContact = normalizeContactEmailForSave(a.contact_email);
    return (
      this.appDisplayName() !== a.app_display_name ||
      (this.logoUrl() || null) !== (a.logo_url ?? null) ||
      contact !== storedContact ||
      primary !== (a.primary_color || '#0d9488').toLowerCase() ||
      domain !== (a.email_domain ?? null)
    );
  });

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      const agencies = await this.agencyService.listMyAgencies();
      const brandId = this.brand.brand().id;
      const match = brandId ? agencies.find((a) => a.id === brandId) : null;
      const current = match ?? agencies[0] ?? null;
      if (!current) {
        this.loadError.set('No agency available for this account.');
        return;
      }
      this.agency.set(current);
      this.appDisplayName.set(current.app_display_name);
      // Neutralize the provision-time sentinel ('unknown@unknown.invalid') so
      // the field renders empty (with its placeholder), never the literal value.
      this.contactEmail.set(displayContactEmail(current.contact_email));
      this.logoUrl.set(current.logo_url ?? '');
      this.emailDomain.set(current.email_domain ?? '');
      this.primaryColorHash.set((current.primary_color ?? '#0d9488').toLowerCase());
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : 'Failed to load agency.');
    }
  }

  async onFetchBrand(): Promise<void> {
    const domain = this.fetchDomain().trim();
    if (!domain) return;
    this.fetching.set(true);
    this.fetchError.set(null);
    this.fetchPreview.set(null);
    try {
      const result = await this.agencyService.fetchBrandFromDomain(domain);
      if (!result.logo_url && !result.primary_color) {
        this.fetchError.set('No brand assets found for this domain.');
        return;
      }
      this.fetchPreview.set(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to fetch brand';
      this.fetchError.set(msg.includes('domain_not_found') ? 'Domain not found in Brandfetch.' : msg);
    } finally {
      this.fetching.set(false);
    }
  }

  applyFetchedBrand(): void {
    const preview = this.fetchPreview();
    if (!preview) return;
    if (preview.logo_url) this.logoUrl.set(preview.logo_url);
    if (preview.primary_color) this.primaryColorHash.set(preview.primary_color);
    if (preview.name && !this.appDisplayName()) this.appDisplayName.set(preview.name);
    this.fetchPreview.set(null);
    this.messageService.add({
      severity: 'info',
      summary: 'Brand applied. Review and save when ready.',
      life: 4000,
    });
  }

  async onSave(): Promise<void> {
    const a = this.agency();
    if (!a) return;
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const branding: AgencyBrandingUpdate = {};
      const displayName = this.appDisplayName();
      if (displayName !== a.app_display_name) {
        branding.app_display_name = displayName.trim() || a.name;
      }
      const primary = '#' + this.primaryColorHash().replace(/^#/, '').toLowerCase();
      if (primary !== (a.primary_color || '#0d9488').toLowerCase()) {
        branding.primary_color = primary;
      }
      const newLogo = this.logoUrl().trim() || null;
      if (newLogo !== (a.logo_url ?? null)) {
        branding.logo_url = newLogo;
      }
      // Persist the normalized value: an empty field or the sentinel typed back
      // in is written as '' (a clear), never the literal 'unknown@unknown.invalid'.
      const newContact = normalizeContactEmailForSave(this.contactEmail());
      if (newContact !== normalizeContactEmailForSave(a.contact_email)) {
        branding.contact_email = newContact;
      }
      const domain = (this.emailDomain() || '').trim().toLowerCase() || null;
      if (domain !== (a.email_domain ?? null)) {
        branding.email_domain = domain;
      }
      if (Object.keys(branding).length === 0) {
        this.saving.set(false);
        return;
      }
      await this.agencyService.updateAgencyBranding(a.id, branding);
      this.messageService.add({
        severity: 'success',
        summary: 'Agency branding updated.',
        life: 3000,
      });
      await this.load();
    } catch (e) {
      this.saveError.set(e instanceof Error ? e.message : 'Failed to save branding.');
    } finally {
      this.saving.set(false);
    }
  }
}
