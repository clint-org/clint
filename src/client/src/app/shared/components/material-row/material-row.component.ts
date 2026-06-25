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
  materialExtLabel,
} from '../../../core/models/material.model';
import { SpaceRoleService } from '../../../core/services/space-role.service';
import { routeForLink } from './material-link-route';

/**
 * A single linked-entity chip the row renders. `route` is null when the
 * entity has no standalone page (an unassigned marker) or when tenant/space
 * context is unavailable; the template then renders the chip as plain,
 * non-link text. `deleted` flags a link whose entity name resolved null
 * server-side.
 */
interface MaterialLinkChip {
  key: string;
  type: MaterialEntityType;
  typeLabel: string;
  name: string;
  route: unknown[] | null;
  queryParams: Record<string, string> | null;
  deleted: boolean;
}

/**
 * Single card in a materials list, laid out in three zones:
 * `icon | content | actions`. The icon is a slate document tile whose
 * extension label is tinted by file kind (PPTX amber, PDF red, DOCX blue,
 * other slate). The content column stacks the title (the hero — full width,
 * wraps to two lines then ellipsis), a meta line (type badge + date · size),
 * and the linked-entity chips. Download and (editor/owner-only) Delete icon
 * buttons sit top-right. The card itself is not a button.
 */
@Component({
  selector: 'app-material-row',
  standalone: true,
  imports: [RouterLink, TooltipModule],
  template: `
    <div
      class="group flex w-full items-start gap-3 rounded-sm border border-slate-200 bg-white p-3 transition-colors hover:border-slate-300 hover:bg-slate-50"
    >
      <!-- File-type tile: slate document with a folded corner; the extension
           label is tinted by kind (PPTX amber, PDF red, DOCX blue, other slate). -->
      <span
        class="relative flex h-12 w-10 shrink-0 items-end justify-center rounded-sm border border-slate-300 bg-white pb-1.5"
        aria-hidden="true"
      >
        <span
          class="absolute right-0 top-0 h-2.5 w-2.5 border-b border-l border-slate-300 bg-slate-100"
        ></span>
        <span [class]="'font-mono text-[8px] font-bold tracking-wider ' + iconColor()">{{
          extLabel()
        }}</span>
      </span>

      <!-- Content: title (hero) + meta line + linked-entity chips -->
      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3
          class="line-clamp-2 text-sm font-semibold leading-snug text-slate-900"
          [title]="material().title"
        >
          {{ material().title }}
        </h3>

        <div class="flex flex-wrap items-center gap-2">
          <span
            class="shrink-0 rounded-sm border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-500"
          >
            {{ typeLabel() }}
          </span>
          <span class="font-mono text-[11px] tabular-nums text-slate-500">
            {{ formattedDate() }} · {{ formattedSize() }}
          </span>
        </div>

        @if (showLinks() && chips().length) {
          <div class="flex min-w-0 flex-wrap items-center gap-1.5">
            @for (chip of chips(); track chip.key) {
              @if (chip.route) {
                <a
                  [routerLink]="chip.route"
                  [queryParams]="chip.queryParams"
                  class="inline-flex min-w-0 max-w-full items-center gap-1 rounded-sm border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <span
                    class="shrink-0 font-mono text-[9px] uppercase tracking-wider text-slate-400"
                    >{{ chip.typeLabel }}</span
                  >
                  <span class="min-w-0 truncate font-medium">{{ chip.name }}</span>
                </a>
              } @else {
                <span
                  class="inline-flex min-w-0 max-w-full items-center gap-1 rounded-sm border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px]"
                  [class.text-slate-400]="chip.deleted"
                  [class.text-slate-600]="!chip.deleted"
                  [class.italic]="chip.deleted"
                >
                  <span
                    class="shrink-0 font-mono text-[9px] uppercase tracking-wider text-slate-400"
                    >{{ chip.typeLabel }}</span
                  >
                  <span class="min-w-0 truncate">{{ chip.name }}</span>
                </span>
              }
            }
          </div>
        } @else if (showLinks() && fallbackSummary()) {
          <div class="text-[11px] text-slate-500">{{ fallbackSummary() }}</div>
        }
      </div>

      <!-- Action buttons (fixed top-right slot; subtle, intensify on hover) -->
      <div class="flex shrink-0 items-center gap-1">
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-sm border border-transparent text-slate-400 transition-colors hover:border-slate-200 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
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
            class="flex h-7 w-7 items-center justify-center rounded-sm border border-transparent text-slate-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 focus:outline-none focus:ring-1 focus:ring-red-400"
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
  private readonly spaceRole = inject(SpaceRoleService);
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

  // Any space editor/owner may delete a material -- it is a shared engagement
  // artifact, not personal to the uploader. Mirrors delete_material's
  // has_space_access(owner/editor) gate (server remains authoritative).
  protected readonly canDelete = computed(() => this.spaceRole.canEdit());

  protected readonly kind = computed<MaterialFileKind>(() =>
    classifyMaterialMime(this.material().mime_type, this.material().file_name)
  );

  protected readonly extLabel = computed(() =>
    materialExtLabel(this.material().file_name, this.kind())
  );

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
    const target = deleted ? null : routeForLink(link, tenant, space);
    return {
      key: `${link.entity_type}:${link.entity_id}:${index}`,
      type: link.entity_type,
      typeLabel,
      name,
      route: target?.commands ?? null,
      queryParams: target?.queryParams ?? null,
      deleted,
    };
  }

  protected entityLabel(t: string): string {
    return MATERIAL_ENTITY_LABEL[t as keyof typeof MATERIAL_ENTITY_LABEL] ?? t;
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
