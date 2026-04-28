import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TenantService } from '../../core/services/tenant.service';

@Component({
  selector: 'app-provision-demo',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div class="max-w-sm text-center">
        @if (error()) {
          <i class="fa-solid fa-circle-exclamation mb-3 text-2xl text-red-500"></i>
          <p class="text-sm font-medium text-slate-900">{{ error() }}</p>
          <a
            routerLink="/onboarding"
            class="mt-3 inline-block text-xs text-brand-700 hover:text-brand-800 hover:underline"
          >
            Back to onboarding
          </a>
        } @else {
          <div
            class="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600"
            role="status"
            aria-label="Provisioning demo workspace"
          ></div>
          <p class="mt-4 text-xs uppercase tracking-wider text-slate-400">
            Provisioning demo workspace
          </p>
        }
      </div>
    </div>
  `,
})
export class ProvisionDemoComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly tenantService = inject(TenantService);
  error = signal<string | null>(null);

  async ngOnInit() {
    try {
      const { tenant_id } = await this.tenantService.provisionDemoWorkspace();
      await this.router.navigate(['/t', tenant_id, 'spaces']);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to provision demo workspace');
    }
  }
}
