import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { InputText } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { TabsModule } from 'primeng/tabs';

import { TenantService } from '../../core/services/tenant.service';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [FormsModule, InputText, ButtonModule, MessageModule, TabsModule],
  template: `
    <div class="min-h-screen bg-slate-50 flex items-center justify-center">
      <div class="w-full max-w-md">
        <div class="text-center mb-8">
          <h1 class="text-2xl font-bold text-slate-900">Welcome to Clint</h1>
          <p class="mt-2 text-sm text-slate-500">Create an organization or join an existing one</p>
        </div>

        <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <p-tabs value="0">
            <p-tablist>
              <p-tab value="0">Create Organization</p-tab>
              <p-tab value="1">Join with Code</p-tab>
            </p-tablist>
            <p-tabpanels>
              <p-tabpanel value="0">
                <form (ngSubmit)="createTenant()" class="space-y-4 pt-4">
                  <div>
                    <label for="org-name" class="block text-sm font-medium text-slate-700 mb-1"
                      >Organization Name</label
                    >
                    <input
                      pInputText
                      id="org-name"
                      class="w-full"
                      [(ngModel)]="tenantName"
                      name="tenantName"
                      placeholder="e.g. Acme Pharma"
                      required
                    />
                  </div>
                  @if (createError()) {
                    <p-message severity="error" [closable]="false">{{ createError() }}</p-message>
                  }
                  <p-button
                    label="Create Organization"
                    type="submit"
                    [loading]="creating()"
                    [style]="{ width: '100%' }"
                  />
                </form>
              </p-tabpanel>
              <p-tabpanel value="1">
                <form (ngSubmit)="joinTenant()" class="space-y-4 pt-4">
                  <div>
                    <label for="invite-code" class="block text-sm font-medium text-slate-700 mb-1"
                      >Invite Code</label
                    >
                    <input
                      pInputText
                      id="invite-code"
                      class="w-full"
                      [(ngModel)]="inviteCode"
                      name="inviteCode"
                      placeholder="e.g. AB3K9X2M"
                      required
                    />
                  </div>
                  @if (joinError()) {
                    <p-message severity="error" [closable]="false">{{ joinError() }}</p-message>
                  }
                  <p-button
                    label="Join Organization"
                    type="submit"
                    [loading]="joining()"
                    [style]="{ width: '100%' }"
                  />
                </form>
              </p-tabpanel>
            </p-tabpanels>
          </p-tabs>
        </div>
      </div>
    </div>
  `,
})
export class OnboardingComponent {
  private tenantService = inject(TenantService);
  private router = inject(Router);

  tenantName = '';
  inviteCode = '';
  creating = signal(false);
  joining = signal(false);
  createError = signal<string | null>(null);
  joinError = signal<string | null>(null);

  async createTenant(): Promise<void> {
    if (!this.tenantName.trim()) return;
    this.creating.set(true);
    this.createError.set(null);

    try {
      const slug = this.tenantName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const tenant = await this.tenantService.createTenant(this.tenantName.trim(), slug);
      localStorage.setItem('lastTenantId', tenant.id);
      this.router.navigate(['/t', tenant.id, 'spaces']);
    } catch (e) {
      this.createError.set(e instanceof Error ? e.message : 'Failed to create organization');
    } finally {
      this.creating.set(false);
    }
  }

  async joinTenant(): Promise<void> {
    if (!this.inviteCode.trim()) return;
    this.joining.set(true);
    this.joinError.set(null);

    try {
      const tenant = await this.tenantService.joinByCode(this.inviteCode.trim());
      localStorage.setItem('lastTenantId', tenant.id);
      this.router.navigate(['/t', tenant.id, 'spaces']);
    } catch (e) {
      this.joinError.set(e instanceof Error ? e.message : 'Invalid or expired invite code');
    } finally {
      this.joining.set(false);
    }
  }
}
