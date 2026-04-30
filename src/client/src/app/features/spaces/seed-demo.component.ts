import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DashboardService } from '../../core/services/dashboard.service';

@Component({
  selector: 'app-seed-demo',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div class="max-w-sm text-center">
        @if (error()) {
          <i class="fa-solid fa-circle-exclamation mb-3 text-2xl text-red-500"></i>
          <p class="text-sm font-medium text-slate-900">{{ error() }}</p>
          <a
            [routerLink]="['/t', tenantId, 'spaces']"
            class="mt-3 inline-block text-xs text-brand-700 hover:text-brand-800 hover:underline"
          >
            Back to spaces
          </a>
        } @else {
          <div
            class="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600"
            role="status"
            aria-label="Seeding demo data"
          ></div>
          <p class="mt-4 text-xs uppercase tracking-wider text-slate-400">
            Seeding demo data
          </p>
        }
      </div>
    </div>
  `,
})
export class SeedDemoComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dashboardService = inject(DashboardService);

  readonly error = signal<string | null>(null);
  readonly tenantId = this.route.snapshot.paramMap.get('tenantId') ?? '';

  async ngOnInit(): Promise<void> {
    const spaceId = this.route.snapshot.paramMap.get('spaceId');
    if (!spaceId) {
      this.error.set('Missing space identifier in URL.');
      return;
    }
    try {
      await this.dashboardService.seedDemoData(spaceId);
      await this.router.navigate(['/t', this.tenantId, 's', spaceId, 'catalysts']);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to seed demo data.');
    }
  }
}
