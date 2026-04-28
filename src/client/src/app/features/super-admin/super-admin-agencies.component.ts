import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { MessageService } from 'primeng/api';

import {
  SuperAdminService,
  SuperAdminAgencySummary,
} from '../../core/services/super-admin.service';

type SubdomainStatus =
  | { kind: 'idle' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'taken' }
  | { kind: 'error'; message: string };

const SUBDOMAIN_REGEX = /^[a-z][a-z0-9-]{1,62}$/;
const SLUG_REGEX = /^[a-z][a-z0-9-]{1,99}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Component({
  selector: 'app-super-admin-agencies',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    TableModule,
    ButtonModule,
    Dialog,
    InputText,
    MessageModule,
  ],
  template: `
    <div class="p-6">
      <div class="mb-6 flex items-end justify-between">
        <div>
          <h1 class="text-base font-semibold text-slate-900">Agencies</h1>
          <p class="mt-1 text-xs text-slate-500">
            Every agency in the install. Provision new agencies with a designated owner.
          </p>
        </div>
        <p-button
          label="Provision agency"
          icon="fa-solid fa-plus"
          size="small"
          (onClick)="openProvision()"
        />
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

      <p-table
        styleClass="data-table"
        [value]="agencies()"
        [loading]="loading()"
        [tableStyle]="{ 'min-width': '70rem' }"
        aria-label="All agencies"
      >
        <ng-template #header>
          <tr>
            <th>Name</th>
            <th>Slug</th>
            <th>Subdomain</th>
            <th>Plan</th>
            <th class="text-right">Max tenants</th>
            <th class="text-right">Tenants</th>
            <th>Created</th>
            <th class="text-right w-12"><span class="sr-only">Actions</span></th>
          </tr>
        </ng-template>
        <ng-template #body let-agency>
          <tr>
            <td class="font-medium text-slate-900">{{ agency.name }}</td>
            <td class="col-identifier text-xs">{{ agency.slug }}</td>
            <td class="col-identifier text-xs">{{ agency.subdomain }}</td>
            <td class="text-xs">{{ agency.plan_tier }}</td>
            <td class="text-right tabular-nums">{{ agency.max_tenants }}</td>
            <td class="text-right tabular-nums">{{ agency.tenant_count }}</td>
            <td class="col-identifier text-xs">{{ agency.created_at | date: 'MMM d, y' }}</td>
            <td class="text-right">
              <p-button
                icon="fa-solid fa-trash"
                severity="danger"
                size="small"
                [text]="true"
                [rounded]="true"
                [attr.aria-label]="'Delete agency ' + agency.name"
                (onClick)="openDelete(agency)"
              />
            </td>
          </tr>
        </ng-template>
        <ng-template #emptymessage>
          <tr>
            <td colspan="8" class="text-center py-8 text-sm text-slate-500">
              No agencies yet. Provision your first one.
            </td>
          </tr>
        </ng-template>
      </p-table>
    </div>

    <!-- Provision dialog -->
    <p-dialog
      [(visible)]="dialogOpen"
      [modal]="true"
      [closable]="true"
      [draggable]="false"
      [resizable]="false"
      [style]="{ width: '28rem' }"
      header="Provision agency"
      (onHide)="resetForm()"
    >
      <form (ngSubmit)="onSubmit()" class="space-y-4">
        <!-- Name -->
        <div>
          <label
            for="agency-name"
            class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
          >
            Agency name
          </label>
          <input
            pInputText
            id="agency-name"
            class="w-full"
            [(ngModel)]="name"
            name="name"
            required
            aria-required="true"
          />
        </div>

        <!-- Slug -->
        <div>
          <label
            for="agency-slug"
            class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
          >
            Slug
          </label>
          <input
            pInputText
            id="agency-slug"
            class="w-full font-mono text-xs"
            [(ngModel)]="slug"
            (ngModelChange)="onSlugChange($event)"
            name="slug"
            required
            aria-required="true"
            spellcheck="false"
            autocomplete="off"
          />
          <p class="mt-1 text-[11px] text-slate-400">
            Lowercase letters, digits, and hyphens. 2-100 characters.
          </p>
        </div>

        <!-- Subdomain -->
        <div>
          <label
            for="agency-subdomain"
            class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
          >
            Subdomain
          </label>
          <input
            pInputText
            id="agency-subdomain"
            class="w-full font-mono text-xs"
            [(ngModel)]="subdomain"
            (ngModelChange)="onSubdomainChange($event)"
            name="subdomain"
            required
            aria-required="true"
            spellcheck="false"
            autocomplete="off"
            [attr.aria-invalid]="
              subdomainStatus().kind === 'taken' || subdomainStatus().kind === 'invalid'
                ? 'true'
                : 'false'
            "
          />
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
                <span>Lowercase letters, digits, hyphens. 2-63 characters.</span>
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

        <!-- Owner email -->
        <div>
          <label
            for="agency-owner"
            class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
          >
            Owner email
          </label>
          <input
            pInputText
            id="agency-owner"
            type="email"
            class="w-full text-sm"
            [(ngModel)]="ownerEmail"
            name="ownerEmail"
            required
            aria-required="true"
            placeholder="owner@example.com"
            spellcheck="false"
            autocomplete="off"
          />
          <p class="mt-1 text-[11px] text-slate-400">
            If they have signed in before, they get owner access immediately.
            Otherwise the invite is held and granted on first sign-in.
          </p>
        </div>

        <!-- Contact email -->
        <div>
          <label
            for="agency-contact"
            class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
          >
            Contact email (optional)
          </label>
          <input
            pInputText
            id="agency-contact"
            type="email"
            class="w-full"
            [(ngModel)]="contactEmail"
            name="contactEmail"
            placeholder="ops@agency.com"
          />
        </div>

        @if (submitError()) {
          <p-message severity="error" [closable]="false">{{ submitError() }}</p-message>
        }

        <div class="flex items-center justify-end gap-3 pt-2 border-t border-slate-200">
          <p-button
            label="Cancel"
            severity="secondary"
            [outlined]="true"
            type="button"
            (onClick)="dialogOpen = false"
          />
          <p-button
            label="Provision"
            type="submit"
            [loading]="submitting()"
            [disabled]="!canSubmit()"
          />
        </div>
      </form>
    </p-dialog>

    <!-- Delete confirmation dialog -->
    <p-dialog
      [(visible)]="deleteDialogOpen"
      [modal]="true"
      [closable]="true"
      [draggable]="false"
      [resizable]="false"
      [style]="{ width: '28rem' }"
      header="Delete agency"
      (onHide)="resetDelete()"
    >
      @if (deleteTarget(); as target) {
        <div class="space-y-4">
          <p class="text-sm text-slate-700">
            Permanently delete
            <strong class="font-semibold text-slate-900">{{ target.name }}</strong>
            and all of its agency members and pending invites. This cannot be undone.
          </p>
          <p class="text-xs text-slate-500">
            The subdomain
            <code class="font-mono text-slate-700">{{ target.subdomain }}</code>
            will be immediately re-usable (no 90-day holdback).
          </p>
          @if (target.tenant_count > 0) {
            <p-message severity="error" [closable]="false">
              This agency has {{ target.tenant_count }} tenant(s). Detach or delete
              those tenants first.
            </p-message>
          } @else {
            <div>
              <label
                for="delete-confirm"
                class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
              >
                Type the agency name to confirm
              </label>
              <input
                pInputText
                id="delete-confirm"
                class="w-full"
                [ngModel]="deleteConfirmText()"
                (ngModelChange)="deleteConfirmText.set($event)"
                name="deleteConfirm"
                spellcheck="false"
                autocomplete="off"
                [placeholder]="target.name"
              />
            </div>
          }
          @if (deleteError()) {
            <p-message severity="error" [closable]="false">{{ deleteError() }}</p-message>
          }
          <div class="flex items-center justify-end gap-3 pt-2 border-t border-slate-200">
            <p-button
              label="Cancel"
              severity="secondary"
              [outlined]="true"
              type="button"
              (onClick)="deleteDialogOpen = false"
            />
            <p-button
              label="Delete"
              severity="danger"
              type="button"
              [loading]="deleting()"
              [disabled]="!canDelete()"
              (onClick)="onConfirmDelete()"
            />
          </div>
        </div>
      }
    </p-dialog>
  `,
})
export class SuperAdminAgenciesComponent implements OnInit {
  private readonly service = inject(SuperAdminService);
  private readonly messageService = inject(MessageService);

  readonly agencies = signal<SuperAdminAgencySummary[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  // Dialog state
  dialogOpen = false;
  name = '';
  slug = '';
  subdomain = '';
  ownerEmail = '';
  contactEmail = '';

  readonly subdomainStatus = signal<SubdomainStatus>({ kind: 'idle' });
  readonly statusReason = computed(() => {
    const s = this.subdomainStatus();
    if (s.kind === 'invalid') return s.reason;
    if (s.kind === 'error') return s.message;
    return '';
  });
  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);

  private debounceHandle: ReturnType<typeof setTimeout> | null = null;

  // Delete dialog state
  deleteDialogOpen = false;
  readonly deleteConfirmText = signal('');
  readonly deleteTarget = signal<SuperAdminAgencySummary | null>(null);
  readonly deleting = signal(false);
  readonly deleteError = signal<string | null>(null);

  readonly canSubmit = computed(() => {
    const subdomainAvailable = this.subdomainStatus().kind === 'available';
    const notSubmitting = !this.submitting();
    return (
      subdomainAvailable &&
      notSubmitting &&
      this.name.trim().length > 0 &&
      SLUG_REGEX.test(this.slug.trim()) &&
      EMAIL_REGEX.test(this.ownerEmail.trim())
    );
  });

  readonly canDelete = computed(() => {
    const target = this.deleteTarget();
    const confirm = this.deleteConfirmText();
    const isDeleting = this.deleting();
    if (!target) return false;
    if (isDeleting) return false;
    if (target.tenant_count > 0) return false;
    return confirm.trim() === target.name;
  });

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const list = await this.service.listAllAgencies();
      this.agencies.set(list);
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : 'Failed to load agencies.');
    } finally {
      this.loading.set(false);
    }
  }

  openProvision(): void {
    this.resetForm();
    this.dialogOpen = true;
  }

  resetForm(): void {
    this.name = '';
    this.slug = '';
    this.subdomain = '';
    this.ownerEmail = '';
    this.contactEmail = '';
    this.subdomainStatus.set({ kind: 'idle' });
    this.submitError.set(null);
  }

  onSlugChange(value: string): void {
    const cleaned = (value || '').toLowerCase().trim();
    if (this.slug !== cleaned) this.slug = cleaned;
  }

  onSubdomainChange(value: string): void {
    const cleaned = (value || '').toLowerCase().trim();
    if (this.subdomain !== cleaned) this.subdomain = cleaned;
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
        reason: 'Must start with a letter; lowercase letters, digits, hyphens. 2-63 characters.',
      });
      return;
    }
    this.subdomainStatus.set({ kind: 'checking' });
    this.debounceHandle = setTimeout(async () => {
      try {
        const available = await this.service.checkSubdomainAvailable(cleaned);
        if (cleaned !== this.subdomain) return;
        this.subdomainStatus.set({ kind: available ? 'available' : 'taken' });
      } catch (e) {
        if (cleaned !== this.subdomain) return;
        this.subdomainStatus.set({
          kind: 'error',
          message: e instanceof Error ? e.message : 'unknown error',
        });
      }
    }, 300);
  }

  async onSubmit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.submitting.set(true);
    this.submitError.set(null);
    try {
      const result = await this.service.provisionAgency(
        this.name.trim(),
        this.slug.trim(),
        this.subdomain.trim(),
        this.ownerEmail.trim(),
        this.contactEmail.trim() || null
      );
      this.messageService.add({
        severity: 'success',
        summary: result.owner_invited
          ? `Agency "${result.name}" provisioned. Owner invite held for ${result.owner_email}; granted on first sign-in.`
          : `Agency "${result.name}" provisioned. ${result.owner_email} added as owner.`,
        life: 5000,
      });
      this.dialogOpen = false;
      this.resetForm();
      await this.load();
    } catch (e) {
      this.submitError.set(e instanceof Error ? e.message : 'Failed to provision agency.');
    } finally {
      this.submitting.set(false);
    }
  }

  openDelete(agency: SuperAdminAgencySummary): void {
    this.deleteTarget.set(agency);
    this.deleteConfirmText.set('');
    this.deleteError.set(null);
    this.deleteDialogOpen = true;
  }

  resetDelete(): void {
    this.deleteTarget.set(null);
    this.deleteConfirmText.set('');
    this.deleteError.set(null);
    this.deleting.set(false);
  }

  async onConfirmDelete(): Promise<void> {
    const target = this.deleteTarget();
    if (!target || !this.canDelete()) return;
    this.deleting.set(true);
    this.deleteError.set(null);
    try {
      const result = await this.service.deleteAgency(target.id);
      this.messageService.add({
        severity: 'success',
        summary: `Agency "${result.name}" deleted (${result.members_removed} member(s), ${result.invites_removed} pending invite(s) removed). Subdomain "${result.subdomain}" is free.`,
        life: 5000,
      });
      this.deleteDialogOpen = false;
      this.resetDelete();
      await this.load();
    } catch (e) {
      this.deleteError.set(e instanceof Error ? e.message : 'Failed to delete agency.');
    } finally {
      this.deleting.set(false);
    }
  }
}
