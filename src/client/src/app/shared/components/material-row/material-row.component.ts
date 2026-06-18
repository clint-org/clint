import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TooltipModule } from 'primeng/tooltip';

import {
  MATERIAL_ENTITY_LABEL,
  MATERIAL_TYPE_LABEL,
  Material,
  MaterialEntityType,
  MaterialFileKind,
  MaterialLink,
  classifyMaterialMime,
} from '../../../core/models/material.model';
import { SupabaseService } from '../../../core/services/supabase.service';

/**
 * A single linked-entity chip the row renders. `route` is null when the
 * entity has no standalone page (markers) or when tenant/space context is
 * unavailable; the template then renders the chip as plain, non-link text.
 * `deleted` flags a link whose entity name resolved null server-side.
 */
interface MaterialLinkChip {
  key: string;
  type: MaterialEntityType;
  typeLabel: string;
  name: string;
  route: unknown[] | null;
  deleted: boolean;
}

/**
 * Single row in a materials list. File-type icon (PPTX amber, PDF red,
 * DOCX blue) leads; title and metadata follow; inline Download and
 * (uploader-only) Delete actions sit at the end. The row itself is no
 * longer a button.
 */
@Component({
  selector: 'app-material-row',
  standalone: true,
  imports: [RouterLink, TooltipModule],
  template: `
    <div class="group flex w-full items-center gap-3.5 px-5 py-3 transition-colors hover:bg-slate-50">
      <!-- File-type glyph (PowerPoint amber, PDF red, Word blue, other slate) -->
      <span class="flex h-10 w-7 shrink-0 items-center justify-center" aria-hidden="true">
        <i [class]="'fa-solid text-[26px] ' + iconGlyph() + ' ' + iconColor()"></i>
      </span>

      <!-- Title + linked-entity chips -->
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <p class="truncate text-sm font-semibold text-slate-900">
            {{ material().title }}
          </p>
          <span
            class="shrink-0 rounded-sm border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-slate-500"
          >
            {{ typeLabel() }}
          </span>
        </div>
        @if (showLinks() && chips().length) {
          <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
            @for (chip of chips(); track chip.key) {
              @if (chip.route) {
                <a
                  [routerLink]="chip.route"
                  class="inline-flex max-w-[16rem] items-center gap-1 rounded-sm border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <span class="font-mono text-[9px] uppercase tracking-wider text-slate-400">{{
                    chip.typeLabel
                  }}</span>
                  <span class="truncate font-medium">{{ chip.name }}</span>
                </a>
              } @else {
                <span
                  class="inline-flex max-w-[16rem] items-center gap-1 rounded-sm border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px]"
                  [class.text-slate-400]="chip.deleted"
                  [class.text-slate-600]="!chip.deleted"
                  [class.italic]="chip.deleted"
                >
                  <span class="font-mono text-[9px] uppercase tracking-wider text-slate-400">{{
                    chip.typeLabel
                  }}</span>
                  <span class="truncate">{{ chip.name }}</span>
                </span>
              }
            }
          </div>
        } @else if (showLinks() && fallbackSummary()) {
          <div class="mt-1.5 text-[11px] text-slate-500">{{ fallbackSummary() }}</div>
        }
      </div>

      <!-- Date / size, right-aligned tabular figures -->
      <div class="hidden shrink-0 text-right sm:block">
        <div class="font-mono text-[11px] font-semibold tabular-nums text-slate-700">
          {{ formattedDate() }}
        </div>
        <div class="mt-0.5 font-mono text-[10px] tabular-nums text-slate-400">
          {{ formattedSize() }}
        </div>
      </div>

      <!-- Action buttons (fixed slot; revealed on hover, always keyboard-reachable) -->
      <div class="flex shrink-0 items-center gap-1">
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-sm border border-slate-200 text-slate-400 opacity-40 transition-opacity hover:bg-slate-100 hover:text-slate-700 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-brand-500 group-hover:opacity-100"
          (click)="downloadClick.emit(material())"
          [pTooltip]="'Download ' + material().title"
          tooltipPosition="top"
          [attr.aria-label]="'Download ' + material().title"
        >
          <i class="fa-solid fa-arrow-down text-xs"></i>
        </button>
        @if (canDelete()) {
          <button
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded-sm border border-slate-200 text-slate-400 opacity-40 transition-opacity hover:border-red-200 hover:bg-red-50 hover:text-red-600 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-red-400 group-hover:opacity-100"
            (click)="deleteClick.emit(material())"
            [pTooltip]="'Delete ' + material().title"
            tooltipPosition="top"
            [attr.aria-label]="'Delete ' + material().title"
          >
            <i class="fa-solid fa-trash text-xs"></i>
          </button>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MaterialRowComponent {
  private readonly supabase = inject(SupabaseService);
  private readonly route = inject(ActivatedRoute);

  readonly material = input.required<Material>();
  readonly showLinks = input<boolean>(true);
  /**
   * Tenant/space context for building linked-entity chip routes. Optional:
   * when not supplied the row derives them from the route ancestry. When
   * neither yields a value, chips render as non-link text.
   */
  readonly tenantId = input<string | null>(null);
  readonly spaceId = input<string | null>(null);

  readonly downloadClick = output<Material>();
  readonly deleteClick = output<Material>();

  protected readonly canDelete = computed(() => {
    const userId = this.supabase.currentUser()?.id;
    return !!userId && this.material().uploaded_by === userId;
  });

  protected readonly kind = computed<MaterialFileKind>(() =>
    classifyMaterialMime(this.material().mime_type, this.material().file_name)
  );

  protected readonly iconGlyph = computed(() => {
    switch (this.kind()) {
      case 'pptx':
        return 'fa-file-powerpoint';
      case 'pdf':
        return 'fa-file-pdf';
      case 'docx':
        return 'fa-file-word';
      default:
        return 'fa-file-lines';
    }
  });

  protected readonly iconColor = computed(() => {
    switch (this.kind()) {
      case 'pptx':
        return 'text-amber-600';
      case 'pdf':
        return 'text-red-600';
      case 'docx':
        return 'text-blue-600';
      default:
        return 'text-slate-500';
    }
  });

  protected readonly typeLabel = computed(() => MATERIAL_TYPE_LABEL[this.material().material_type]);

  protected readonly formattedDate = computed(() => {
    const d = new Date(this.material().uploaded_at);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  });

  protected readonly formattedSize = computed(() => {
    const bytes = this.material().file_size_bytes;
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
  });

  /** Tenant id: explicit input first, else walked from the route ancestry. */
  protected readonly resolvedTenantId = computed(
    () => this.tenantId() ?? findRouteParam(this.route, 'tenantId')
  );

  /** Space id: explicit input first, else walked from the route ancestry. */
  protected readonly resolvedSpaceId = computed(
    () => this.spaceId() ?? findRouteParam(this.route, 'spaceId')
  );

  /**
   * One chip per linked entity. Each chip shows "[TYPE] Name" and links to the
   * entity's page when the type has one and tenant/space context is known.
   * Markers never link (no standalone page). A link whose name resolved null
   * server-side (deleted entity) renders as a muted "(deleted {type})".
   */
  protected readonly chips = computed<MaterialLinkChip[]>(() => {
    const tenant = this.resolvedTenantId();
    const space = this.resolvedSpaceId();
    return this.material().links.map((link, i) => this.toChip(link, i, tenant, space));
  });

  /**
   * Legacy single-vs-multi summary, used only when chips carry no names at all
   * (e.g. an older payload without entity_name). Keeps the row informative
   * without inventing labels.
   */
  protected readonly fallbackSummary = computed(() => {
    const links = this.material().links;
    if (this.chips().some((c) => !!c.name)) return '';
    if (links.length > 1) return `Linked to ${links.length} entities`;
    if (links.length === 1) return `${this.entityLabel(links[0].entity_type)} link`;
    return '';
  });

  private toChip(
    link: MaterialLink,
    index: number,
    tenant: string,
    space: string
  ): MaterialLinkChip {
    const typeLabel = this.entityLabel(link.entity_type);
    const deleted = link.entity_name == null;
    const name = deleted ? `(deleted ${typeLabel.toLowerCase()})` : link.entity_name!;
    return {
      key: `${link.entity_type}:${link.entity_id}:${index}`,
      type: link.entity_type,
      typeLabel,
      name,
      route: deleted ? null : routeForLink(link, tenant, space),
      deleted,
    };
  }

  protected entityLabel(t: string): string {
    return MATERIAL_ENTITY_LABEL[t as keyof typeof MATERIAL_ENTITY_LABEL] ?? t;
  }
}

/**
 * Route commands for a linked entity, or null when the type has no standalone
 * page (markers) or tenant/space context is missing. Mirrors the entity
 * routes used by marker-detail-content.
 */
function routeForLink(link: MaterialLink, tenant: string, space: string): unknown[] | null {
  if (!tenant || !space) return null;
  const base = ['/t', tenant, 's', space];
  switch (link.entity_type) {
    case 'company':
      return [...base, 'manage', 'companies', link.entity_id];
    case 'product':
      return [...base, 'manage', 'assets', link.entity_id];
    case 'trial':
      return [...base, 'manage', 'trials', link.entity_id];
    case 'space':
      return base;
    case 'marker':
    default:
      return null;
  }
}

/** Walk the route ancestry for a parameter (snapshot is stable for a row). */
function findRouteParam(route: ActivatedRoute, name: string): string {
  let snap = route.snapshot;
  while (snap) {
    const v = snap.paramMap.get(name);
    if (v) return v;
    if (!snap.parent) break;
    snap = snap.parent;
  }
  return '';
}
