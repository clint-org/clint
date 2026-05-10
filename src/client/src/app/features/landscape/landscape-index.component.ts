import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  resource,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { BullseyeDimension } from '../../core/models/landscape.model';
import { LandscapeService } from '../../core/services/landscape.service';

@Component({
  selector: 'app-landscape-index',
  standalone: true,
  imports: [RouterLink, ButtonModule, MessageModule, SkeletonComponent],
  templateUrl: './landscape-index.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandscapeIndexComponent implements OnInit {
  private readonly landscapeService = inject(LandscapeService);
  private readonly route = inject(ActivatedRoute);

  readonly tenantId = signal('');
  readonly spaceId = signal('');
  readonly dimension = signal<BullseyeDimension>('therapeutic-area');
  protected readonly skeletonCards = [0, 1, 2, 3, 4, 5, 6, 7];

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
    params: () => ({
      spaceId: this.spaceId(),
      dimension: this.dimension(),
    }),
    loader: async ({ params }) => {
      if (!params.spaceId) return [];
      return this.landscapeService.getLandscapeIndex(params.spaceId, params.dimension);
    },
  });

  ngOnInit(): void {
    // tenantId and spaceId live on ancestor routes, so walk up the tree
    let snap = this.route.snapshot;
    while (snap) {
      if (snap.paramMap.has('tenantId')) this.tenantId.set(snap.paramMap.get('tenantId')!);
      if (snap.paramMap.has('spaceId')) this.spaceId.set(snap.paramMap.get('spaceId')!);
      snap = snap.parent!;
    }

    // Parse dimension from this component's own URL segment (e.g. "by-company")
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
      company: 'All companies',
      moa: 'All mechanisms of action',
      roa: 'All routes of administration',
    };
    return labels[this.dimension()];
  }

  protected emptyMessage(): string {
    const messages: Record<BullseyeDimension, string> = {
      'therapeutic-area':
        'No therapeutic areas tracked yet. Add one to start building a landscape view.',
      company: 'No companies tracked yet. Add companies and products to see them here.',
      moa: 'No mechanisms of action defined yet. Add them in Manage to start.',
      roa: 'No routes of administration defined yet. Add them in Manage to start.',
    };
    return messages[this.dimension()];
  }

  protected routeSegment(): string {
    const segments: Record<BullseyeDimension, string> = {
      'therapeutic-area': 'by-therapy-area',
      company: 'by-company',
      moa: 'by-moa',
      roa: 'by-roa',
    };
    return segments[this.dimension()];
  }
}
