import { Component, inject, OnInit, resource, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';

import { BullseyeDimension } from '../../core/models/landscape.model';
import { LandscapeService } from '../../core/services/landscape.service';

@Component({
  selector: 'app-landscape-index',
  standalone: true,
  imports: [RouterLink, ButtonModule, MessageModule, ProgressSpinner],
  templateUrl: './landscape-index.component.html',
})
export class LandscapeIndexComponent implements OnInit {
  private readonly landscapeService = inject(LandscapeService);
  private readonly route = inject(ActivatedRoute);

  readonly tenantId = signal('');
  readonly spaceId = signal('');
  readonly dimension = signal<BullseyeDimension>('therapeutic-area');

  private static parseDimension(segment: string): BullseyeDimension {
    const map: Record<string, BullseyeDimension> = {
      'by-therapy-area': 'therapeutic-area',
      'by-company': 'company',
      'by-moa': 'moa',
      'by-roa': 'roa',
    };
    return map[segment] ?? 'therapeutic-area';
  }

  readonly indexData = resource({
    request: () => ({
      spaceId: this.spaceId(),
      dimension: this.dimension(),
    }),
    loader: async ({ request }) => {
      if (!request.spaceId) return [];
      return this.landscapeService.getLandscapeIndex(request.spaceId, request.dimension);
    },
  });

  ngOnInit(): void {
    this.tenantId.set(this.route.snapshot.paramMap.get('tenantId') ?? '');
    this.spaceId.set(this.route.snapshot.paramMap.get('spaceId') ?? '');

    // Parse dimension from current URL segment
    const url = this.route.snapshot.url;
    const dimSegment = url.find((s) =>
      ['by-therapy-area', 'by-company', 'by-moa', 'by-roa'].includes(s.path)
    );
    if (dimSegment) {
      this.dimension.set(LandscapeIndexComponent.parseDimension(dimSegment.path));
    }
  }

  retry(): void {
    this.indexData.reload();
  }

  protected dimensionLabel(): string {
    const labels: Record<BullseyeDimension, string> = {
      'therapeutic-area': 'All therapeutic areas',
      'company': 'All companies',
      'moa': 'All mechanisms of action',
      'roa': 'All routes of administration',
    };
    return labels[this.dimension()];
  }

  protected emptyMessage(): string {
    const messages: Record<BullseyeDimension, string> = {
      'therapeutic-area': 'No therapeutic areas tracked yet. Add one to start building a landscape view.',
      'company': 'No companies tracked yet. Add companies and products to see them here.',
      'moa': 'No mechanisms of action defined yet. Add them in Manage to start.',
      'roa': 'No routes of administration defined yet. Add them in Manage to start.',
    };
    return messages[this.dimension()];
  }

  protected routeSegment(): string {
    const segments: Record<BullseyeDimension, string> = {
      'therapeutic-area': 'by-therapy-area',
      'company': 'by-company',
      'moa': 'by-moa',
      'roa': 'by-roa',
    };
    return segments[this.dimension()];
  }
}
