import { Component, inject } from '@angular/core';
import { BrandContextService } from '../../core/services/brand-context.service';

@Component({
  selector: 'app-super-admin-placeholder',
  standalone: true,
  template: `
    <div class="p-8">
      <h1 class="text-xl font-semibold text-slate-900">
        {{ brand.appDisplayName() }} super-admin portal
      </h1>
      <p class="mt-2 text-sm text-slate-600">Super-admin portal coming in plan 9.</p>
    </div>
  `,
})
export class SuperAdminPlaceholderComponent {
  protected readonly brand = inject(BrandContextService);
}
