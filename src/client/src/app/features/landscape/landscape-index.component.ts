import { Component, inject, OnInit, resource, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';

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

  readonly indexData = resource({
    request: () => ({ spaceId: this.spaceId() }),
    loader: async ({ request }) => {
      if (!request.spaceId) return [];
      return this.landscapeService.getLandscapeIndex(request.spaceId);
    },
  });

  ngOnInit(): void {
    this.tenantId.set(this.route.snapshot.paramMap.get('tenantId') ?? '');
    this.spaceId.set(this.route.snapshot.paramMap.get('spaceId') ?? '');
  }

  retry(): void {
    this.indexData.reload();
  }
}
