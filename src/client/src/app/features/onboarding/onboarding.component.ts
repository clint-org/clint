import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { InputText } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { TenantService } from '../../core/services/tenant.service';
import { SpaceService } from '../../core/services/space.service';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [FormsModule, InputText, ButtonModule, MessageModule],
  template: `
    <div class="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div class="w-full max-w-md">
        <div class="mb-6 text-center">
          <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Welcome
          </p>
          <h1 class="mt-1 text-lg font-semibold tracking-tight text-slate-900">
            Join your team
          </h1>
          <p class="mt-1 text-xs text-slate-500">
            Enter the invite code your administrator sent you.
          </p>
        </div>

        <div class="border border-slate-200 bg-white">
          <div class="h-0.5 bg-brand-500"></div>
          <div class="p-6">
            <form (ngSubmit)="joinTenant()" class="space-y-4">
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
                label="Join"
                type="submit"
                [loading]="joining()"
                [style]="{ width: '100%' }"
              />
            </form>
            <p class="mt-4 text-center text-[11px] text-slate-400">
              Don't have an invite? Ask your administrator to send you one.
            </p>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class OnboardingComponent {
  private tenantService = inject(TenantService);
  private spaceService = inject(SpaceService);
  private router = inject(Router);

  inviteCode = '';
  joining = signal(false);
  joinError = signal<string | null>(null);

  async joinTenant(): Promise<void> {
    const code = this.inviteCode.trim();
    if (!code) return;
    this.joining.set(true);
    this.joinError.set(null);

    // Try tenant invite first; on "Invalid invite code" fall back to space invite.
    // Codes from the two paths look different (8-char alphanumeric vs. 32-char
    // hex) but the user only sees a single field, so we try both transparently.
    try {
      const tenant = await this.tenantService.joinByCode(code);
      localStorage.setItem('lastTenantId', tenant.id);
      this.router.navigate(['/t', tenant.id, 'spaces']);
      return;
    } catch (tenantErr) {
      const msg = tenantErr instanceof Error ? tenantErr.message : '';
      const isInvalidTenantCode = /Invalid invite code/i.test(msg);
      if (!isInvalidTenantCode) {
        this.joinError.set(msg || 'Could not accept invite');
        this.joining.set(false);
        return;
      }
    }

    try {
      const space = await this.spaceService.acceptSpaceInviteByCode(code);
      localStorage.setItem('lastTenantId', space.tenant_id);
      localStorage.setItem('lastSpaceId', space.id);
      this.router.navigate(['/t', space.tenant_id, 's', space.id]);
    } catch (e) {
      this.joinError.set(e instanceof Error ? e.message : 'Invalid or expired invite code');
    } finally {
      this.joining.set(false);
    }
  }
}
