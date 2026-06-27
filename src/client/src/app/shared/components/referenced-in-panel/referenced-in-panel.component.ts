import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ReferencedInRow } from '../../../core/models/primary-intelligence.model';
import { buildEntityRouterLink } from '../../utils/intelligence-router-link';

/**
 * Body-only list of the intelligence entries that reference an entity. The
 * card chrome (header, PI mark, count, description) is owned by the
 * surrounding app-section-card; this component renders just the empty state
 * or the linked list. Shared across the asset / trial / company detail pages,
 * which previously each inlined the identical markup and router-link logic.
 */
@Component({
  selector: 'app-referenced-in-panel',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './referenced-in-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReferencedInPanelComponent {
  readonly rows = input.required<ReferencedInRow[]>();
  readonly tenantId = input.required<string | null>();
  readonly spaceId = input.required<string | null>();

  protected referencedRouterLink(ref: ReferencedInRow): unknown[] {
    return (
      buildEntityRouterLink(this.tenantId(), this.spaceId(), ref.entity_type, ref.entity_id) ?? []
    );
  }
}
