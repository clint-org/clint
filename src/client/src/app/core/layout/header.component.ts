import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Select } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { SupabaseService } from '../services/supabase.service';
import { SpaceService } from '../services/space.service';
import { Space } from '../models/space.model';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, FormsModule, Select, ButtonModule],
  template: `
    <header class="bg-white border-b border-slate-200">
      <div class="h-0.5 bg-teal-500"></div>
      <div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div class="flex items-center gap-4">
          <a [routerLink]="['/t', tenantId(), 'spaces']" class="text-base font-semibold text-slate-900 tracking-tight">
            Clint
          </a>

          @if (spaces().length > 0 && spaceId()) {
            <p-select
              [options]="spaces()"
              [ngModel]="spaceId()"
              (ngModelChange)="switchSpace($event)"
              optionLabel="name"
              optionValue="id"
              [style]="{ width: '12rem' }"
              size="small"
            />
          }
        </div>

        @if (spaceId()) {
          <nav class="flex items-center gap-6">
            <a
              [routerLink]="spaceBase()"
              routerLinkActive="text-slate-900 font-medium border-b-2 border-teal-500 pb-px"
              [routerLinkActiveOptions]="{ exact: true }"
              class="text-sm text-slate-500 transition hover:text-slate-900"
            >
              Dashboard
            </a>
            <a
              [routerLink]="spaceBase().concat('manage', 'companies')"
              routerLinkActive="text-slate-900 font-medium border-b-2 border-teal-500 pb-px"
              class="text-sm text-slate-500 transition hover:text-slate-900"
            >
              Companies
            </a>
            <a
              [routerLink]="spaceBase().concat('manage', 'products')"
              routerLinkActive="text-slate-900 font-medium border-b-2 border-teal-500 pb-px"
              class="text-sm text-slate-500 transition hover:text-slate-900"
            >
              Products
            </a>
            <a
              [routerLink]="spaceBase().concat('manage', 'marker-types')"
              routerLinkActive="text-slate-900 font-medium border-b-2 border-teal-500 pb-px"
              class="text-sm text-slate-500 transition hover:text-slate-900"
            >
              Markers
            </a>
            <a
              [routerLink]="spaceBase().concat('manage', 'therapeutic-areas')"
              routerLinkActive="text-slate-900 font-medium border-b-2 border-teal-500 pb-px"
              class="text-sm text-slate-500 transition hover:text-slate-900"
            >
              Therapeutic Areas
            </a>
          </nav>
        }

        <div class="flex items-center gap-3">
          @if (user()) {
            <span class="text-xs text-slate-400">{{ user()!.email }}</span>
          }
          <button
            type="button"
            (click)="onSignOut()"
            class="text-xs text-slate-400 transition hover:text-slate-600"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  `,
})
export class HeaderComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly spaceService = inject(SpaceService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly user = this.supabase.currentUser;
  tenantId = signal('');
  spaceId = signal('');
  spaces = signal<Space[]>([]);

  ngOnInit(): void {
    this.router.events.subscribe(() => this.extractRouteParams());
    this.extractRouteParams();
  }

  spaceBase(): string[] {
    return ['/t', this.tenantId(), 's', this.spaceId()];
  }

  switchSpace(newSpaceId: string): void {
    localStorage.setItem('lastSpaceId', newSpaceId);
    this.router.navigate(['/t', this.tenantId(), 's', newSpaceId]);
  }

  onSignOut(): void {
    this.supabase.signOut();
  }

  private extractRouteParams(): void {
    let r = this.route.root;
    const params: Record<string, string> = {};
    while (r) {
      if (r.snapshot?.params) {
        Object.assign(params, r.snapshot.params);
      }
      r = r.firstChild!;
    }
    if (params['tenantId'] && params['tenantId'] !== this.tenantId()) {
      this.tenantId.set(params['tenantId']);
      this.loadSpaces(params['tenantId']);
    }
    if (params['spaceId']) {
      this.spaceId.set(params['spaceId']);
    }
  }

  private async loadSpaces(tenantId: string): Promise<void> {
    try {
      const spaces = await this.spaceService.listSpaces(tenantId);
      this.spaces.set(spaces);
    } catch {
      this.spaces.set([]);
    }
  }
}
