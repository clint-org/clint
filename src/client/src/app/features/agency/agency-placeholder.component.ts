import { Component, inject } from '@angular/core';
import { BrandContextService } from '../../core/services/brand-context.service';

@Component({
  selector: 'app-agency-placeholder',
  standalone: true,
  template: `
    <div class="p-8">
      <h1 class="text-xl font-semibold text-slate-900">
        {{ brand.appDisplayName() }} agency portal
      </h1>
      <p class="mt-2 text-sm text-slate-600">Agency portal coming in plan 6.</p>
    </div>
  `,
})
export class AgencyPlaceholderComponent {
  protected readonly brand = inject(BrandContextService);
}
