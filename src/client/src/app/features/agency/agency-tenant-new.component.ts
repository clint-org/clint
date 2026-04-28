import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { ColorPicker } from 'primeng/colorpicker';
import { MessageModule } from 'primeng/message';
import { MessageService } from 'primeng/api';

import { AgencyService } from '../../core/services/agency.service';
import { Agency } from '../../core/models/agency.model';
import { BrandContextService } from '../../core/services/brand-context.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';

type SubdomainStatus =
  | { kind: 'idle' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'taken' }
  | { kind: 'error'; message: string };

const SUBDOMAIN_REGEX = /^[a-z][a-z0-9-]{1,62}$/;

@Component({
  selector: 'app-agency-tenant-new',
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
    <app-manage-page-shell [narrow]="true">
      <div class="mb-6 flex items-start gap-4">
        <button
          type="button"
          class="text-xs text-slate-500 hover:text-slate-900"
          (click)="onCancel()"
        >
          <i class="fa-solid fa-arrow-left mr-1.5"></i>Back to tenants
        </button>
      </div>

      <div class="mb-6">
        <h1 class="text-base font-semibold text-slate-900">Provision tenant</h1>
        <p class="mt-1 text-xs text-slate-500">
          Create a new pharma client tenant under your agency.
        </p>
      </div>

      @if (submitError()) {
        <p-message
          severity="error"
          [closable]="true"
          (onClose)="submitError.set(null)"
          styleClass="mb-4"
        >
          {{ submitError() }}
        </p-message>
      }

      <form (ngSubmit)="onSubmit()" class="space-y-5">
        <!-- Name -->
        <div>
          <label
            for="tenant-name"
            class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
          >
            Tenant name
          </label>
          <input
            pInputText
            id="tenant-name"
            class="w-full"
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
            name="name"
            placeholder="e.g. Pfizer Oncology"
            required
            aria-required="true"
          />
        </div>

        <!-- Subdomain -->
        <div>
          <label
            for="tenant-subdomain"
            class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
          >
            Subdomain
          </label>
          <div class="flex items-center gap-2">
            <input
              pInputText
              id="tenant-subdomain"
              class="flex-1"
              [ngModel]="subdomain()"
              (ngModelChange)="onSubdomainChange($event)"
              name="subdomain"
              placeholder="pfizer-oncology"
              required
              aria-required="true"
              [attr.aria-invalid]="subdomainStatus().kind === 'taken' || subdomainStatus().kind === 'invalid' ? 'true' : 'false'"
              autocomplete="off"
              spellcheck="false"
            />
            <span class="text-xs text-slate-400">.&lt;your apex&gt;</span>
          </div>
          <div
            class="mt-1.5 text-[11px] min-h-[1.2em]"
            aria-live="polite"
            [class.text-slate-400]="subdomainStatus().kind === 'idle'"
            [class.text-slate-500]="subdomainStatus().kind === 'checking'"
            [class.text-emerald-600]="subdomainStatus().kind === 'available'"
            [class.text-red-600]="
              subdomainStatus().kind === 'taken' ||
              subdomainStatus().kind === 'invalid' ||
              subdomainStatus().kind === 'error'
            "
          >
            @switch (subdomainStatus().kind) {
              @case ('idle') {
                <span>Lowercase letters, digits, and hyphens. 2-63 characters.</span>
              }
              @case ('checking') {
                <span>Checking availability...</span>
              }
              @case ('available') {
                <span><i class="fa-solid fa-check mr-1"></i>Available</span>
              }
              @case ('taken') {
                <span>Subdomain is already in use or reserved.</span>
              }
              @case ('invalid') {
                <span>{{ statusReason() }}</span>
              }
              @case ('error') {
                <span>Could not check availability: {{ statusReason() }}</span>
              }
            }
          </div>
        </div>

        <!-- Primary color -->
        <div>
          <label
            for="tenant-color"
            class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
          >
            Primary brand color
          </label>
          <div class="flex items-center gap-3">
            <p-colorpicker [(ngModel)]="primaryColorRaw" name="color" [inline]="false" />
            <input
              pInputText
              id="tenant-color"
              class="w-32 font-mono text-xs"
              [(ngModel)]="primaryColorHash"
              name="colorText"
              maxlength="7"
            />
          </div>
        </div>

        <!-- First user email -->
        <div>
          <label
            for="tenant-owner-email"
            class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
          >
            First user email
          </label>
          <input
            pInputText
            id="tenant-owner-email"
            type="email"
            class="w-full"
            [(ngModel)]="firstUserEmail"
            name="firstUserEmail"
            placeholder="lead@pfizer.com"
          />
          <p class="mt-1 text-[11px] text-slate-400">
            Optional. We'll create a tenant invite for this address; share the invite code with them.
          </p>
        </div>

        <div class="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
          <p-button
            label="Cancel"
            severity="secondary"
            [outlined]="true"
            type="button"
            (onClick)="onCancel()"
          />
          <p-button
            label="Provision tenant"
            type="submit"
            [loading]="submitting()"
            [disabled]="!canSubmit()"
          />
        </div>
      </form>
    </app-manage-page-shell>
  `,
})
export class AgencyTenantNewComponent implements OnInit {
  private readonly agencyService = inject(AgencyService);
  private readonly router = inject(Router);
  private readonly messageService = inject(MessageService);
  private readonly brand = inject(BrandContextService);

  readonly agency = signal<Agency | null>(null);
  readonly subdomainStatus = signal<SubdomainStatus>({ kind: 'idle' });
  readonly statusReason = computed(() => {
    const s = this.subdomainStatus();
    if (s.kind === 'invalid') return s.reason;
    if (s.kind === 'error') return s.message;
    return '';
  });
  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);

  readonly name = signal('');
  readonly subdomain = signal('');
  // PrimeNG colorpicker emits without leading "#"; mirror it as-is then normalize on submit.
  primaryColorRaw = '0d9488';
  // Synced text input that includes the leading "#".
  private _primaryColorHash = '#0d9488';
  get primaryColorHash(): string {
    return this._primaryColorHash;
  }
  set primaryColorHash(value: string) {
    this._primaryColorHash = value;
    const stripped = value.replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{6}$/.test(stripped)) {
      this.primaryColorRaw = stripped;
    }
  }
  firstUserEmail = '';

  private debounceHandle: ReturnType<typeof setTimeout> | null = null;

  readonly canSubmit = computed(() => {
    return (
      this.subdomainStatus().kind === 'available' &&
      !this.submitting() &&
      this.name().trim().length > 0
    );
  });

  async ngOnInit(): Promise<void> {
    try {
      const agencies = await this.agencyService.listMyAgencies();
      const brandId = this.brand.brand().id;
      const match = brandId ? agencies.find((a) => a.id === brandId) : null;
      this.agency.set(match ?? agencies[0] ?? null);
      const a = this.agency();
      if (a) {
        // Default to agency primary color so new tenants inherit the agency look.
        this.primaryColorHash = a.primary_color || '#0d9488';
      }
    } catch (e) {
      this.submitError.set(e instanceof Error ? e.message : 'Failed to load agency.');
    }
  }

  onSubdomainChange(value: string): void {
    const cleaned = (value || '').toLowerCase().trim();
    this.subdomain.set(cleaned);
    if (this.debounceHandle) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
    if (cleaned.length === 0) {
      this.subdomainStatus.set({ kind: 'idle' });
      return;
    }
    if (!SUBDOMAIN_REGEX.test(cleaned)) {
      this.subdomainStatus.set({
        kind: 'invalid',
        reason:
          'Must start with a letter; only lowercase letters, digits, and hyphens. 2-63 characters.',
      });
      return;
    }
    this.subdomainStatus.set({ kind: 'checking' });
    this.debounceHandle = setTimeout(async () => {
      try {
        const available = await this.agencyService.checkSubdomainAvailable(cleaned);
        // Race-guard: only apply the result if the subdomain hasn't changed since.
        if (cleaned !== this.subdomain()) return;
        this.subdomainStatus.set({ kind: available ? 'available' : 'taken' });
      } catch (e) {
        if (cleaned !== this.subdomain()) return;
        this.subdomainStatus.set({
          kind: 'error',
          message: e instanceof Error ? e.message : 'unknown error',
        });
      }
    }, 300);
  }

  async onSubmit(): Promise<void> {
    const a = this.agency();
    if (!a) {
      this.submitError.set('No agency available.');
      return;
    }
    if (!this.canSubmit()) return;
    this.submitting.set(true);
    this.submitError.set(null);
    try {
      const primary = this._primaryColorHash.startsWith('#')
        ? this._primaryColorHash.toLowerCase()
        : '#' + this._primaryColorHash.toLowerCase();
      const result = await this.agencyService.provisionTenant(
        a.id,
        this.name().trim(),
        this.subdomain(),
        {
          app_display_name: this.name().trim(),
          primary_color: primary,
        }
      );

      // Optionally create the first-user invite. Failures here shouldn't block the success toast.
      const email = this.firstUserEmail.trim();
      if (email) {
        try {
          await this.agencyService.createTenantInvite(result.id, email, 'owner');
        } catch (inviteErr) {
          console.warn('agency-tenant-new: invite creation failed', inviteErr);
          this.messageService.add({
            severity: 'warn',
            summary: 'Tenant created, but invite failed.',
            detail: inviteErr instanceof Error ? inviteErr.message : String(inviteErr),
            life: 5000,
          });
        }
      }

      this.messageService.add({
        severity: 'success',
        summary: `Tenant "${result.name}" provisioned.`,
        life: 3000,
      });
      this.router.navigate(['/admin/tenants', result.id]);
    } catch (e) {
      this.submitError.set(e instanceof Error ? e.message : 'Failed to provision tenant.');
    } finally {
      this.submitting.set(false);
    }
  }

  onCancel(): void {
    this.router.navigate(['/admin/tenants']);
  }
}
