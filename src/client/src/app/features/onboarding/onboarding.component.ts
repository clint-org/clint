import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
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
    <div class="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div class="w-full max-w-md">
        <div class="mb-6 text-center">
          <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Welcome
          </p>
          <h1 class="mt-1 text-lg font-semibold tracking-tight text-slate-900">
            Set up your organization
          </h1>
          <p class="mt-1 text-xs text-slate-500">
            Create a new organization, or join an existing one with an invite code.
          </p>
        </div>

        <div class="border border-slate-200 bg-white">
          <div class="h-0.5 bg-teal-500"></div>
          <div class="p-6">
            <p-tabs [value]="initialTab">
              <p-tablist>
                <p-tab value="0">Create Organization</p-tab>
                <p-tab value="1">Join with Code</p-tab>
              </p-tablist>
              <p-tabpanels>
                <p-tabpanel value="0">
                  <form (ngSubmit)="createTenant()" class="space-y-4 pt-4">
                    <p class="text-xs text-slate-500">
                      An organization groups your team's clinical trial workspaces and controls
                      member access.
                    </p>
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
                        aria-required="true"
                        [attr.aria-invalid]="createError() ? true : null"
                        aria-describedby="org-name-error"
                      />
                    </div>
                    @if (createError()) {
                      <p-message id="org-name-error" severity="error" [closable]="false">{{
                        createError()
                      }}</p-message>
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
                    <p class="text-xs text-slate-500">
                      Ask your organization admin for an invite code to join an existing team.
                    </p>
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
                        aria-required="true"
                        [attr.aria-invalid]="joinError() ? true : null"
                        aria-describedby="invite-code-error"
                      />
                    </div>
                    @if (joinError()) {
                      <p-message id="invite-code-error" severity="error" [closable]="false">{{
                        joinError()
                      }}</p-message>
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
    </div>
  `,
})
export class OnboardingComponent {
  private tenantService = inject(TenantService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  // ?tab=join lands on the Join with Code panel; default is Create.
  readonly initialTab = this.route.snapshot.queryParamMap.get('tab') === 'join' ? '1' : '0';

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
      this.createError.set(
        e instanceof Error
          ? e.message
          : 'Could not create organization. Check your connection and try again.'
      );
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
