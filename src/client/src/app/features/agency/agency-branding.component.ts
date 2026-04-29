import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { ColorPicker } from 'primeng/colorpicker';
import { MessageModule } from 'primeng/message';
import { MessageService } from 'primeng/api';

import { AgencyService } from '../../core/services/agency.service';
import { Agency, AgencyBrandingUpdate } from '../../core/models/agency.model';
import { BrandContextService } from '../../core/services/brand-context.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';

@Component({
  selector: 'app-agency-branding',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    InputText,
    ColorPicker,
    MessageModule,
    ManagePageShellComponent,
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
        <div class="grid grid-cols-1 gap-4 max-w-2xl sm:grid-cols-2">
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
            />
          </div>
        </div>

        <div class="mt-6 max-w-2xl flex items-center gap-3 pt-4 border-t border-slate-200">
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

        <div class="mt-10 max-w-2xl border-t border-slate-200 pt-6 text-xs text-slate-500">
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
      }
    </app-manage-page-shell>
  `,
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
  readonly primaryColorHash = signal('#0d9488');
  readonly primaryColorRaw = computed(() => this.primaryColorHash().replace(/^#/, ''));

  onPrimaryColorRawChange(raw: string): void {
    const stripped = (raw || '').replace(/^#/, '').toLowerCase();
    this.primaryColorHash.set(stripped ? `#${stripped}` : '');
  }

  readonly hasChanges = computed(() => {
    const a = this.agency();
    if (!a) return false;
    const primary = '#' + this.primaryColorHash().replace(/^#/, '').toLowerCase();
    return (
      this.appDisplayName() !== a.app_display_name ||
      (this.logoUrl() || null) !== (a.logo_url ?? null) ||
      this.contactEmail() !== a.contact_email ||
      primary !== (a.primary_color || '#0d9488').toLowerCase()
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
      this.contactEmail.set(current.contact_email);
      this.logoUrl.set(current.logo_url ?? '');
      this.primaryColorHash.set((current.primary_color ?? '#0d9488').toLowerCase());
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : 'Failed to load agency.');
    }
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
      const newContact = this.contactEmail();
      if (newContact !== a.contact_email) {
        branding.contact_email = newContact.trim();
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
