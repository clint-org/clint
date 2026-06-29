import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { MenuItem } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';

import { isCtgovOwnedMarker } from '../../../core/models/trial-date-marker';
import type { Marker } from '../../../core/models/marker.model';
import { MarkerService } from '../../../core/services/marker.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';
import { LandscapeStateService } from '../../../features/landscape/landscape-state.service';
import { EventFormDialogComponent } from '../../../features/events/event-form/event-form-dialog.component';
import { buildEntityActionMenu } from '../../entity-actions/entity-action-menu';
import { confirmDelete } from '../../utils/confirm-delete';
import { CtgovSourceTagComponent } from '../ctgov-source-tag.component';
import { RowActionsComponent } from '../row-actions.component';
import { SectionCardComponent } from '../section-card.component';
import { StatusTagComponent } from '../status-tag.component';
import { MarkerIconComponent } from '../svg-icons/marker-icon.component';
import { ConfirmationService, MessageService } from 'primeng/api';
import { timelinePlacement, timelinePlacementLabel } from './event-timeline-placement';
import type { EventAnchorType } from './entity-events.service';

/**
 * Standardized "Events" section shared by the trial, company, and asset detail
 * pages: the full events table (glyph, category, type, title, timeline
 * placement, date, projection), the Add-event affordance wired to the host
 * entity, a read-only detail drawer (via the page-mounted entity-marker-drawer),
 * and row-level edit/delete. The parent owns the `events` array and reloads it
 * on `(changed)`; everything else (dialog state, ctgov lock, deep links) lives
 * here so all three pages behave identically.
 */
@Component({
  selector: 'app-entity-events-section',
  imports: [
    DatePipe,
    ButtonModule,
    TableModule,
    SectionCardComponent,
    EventFormDialogComponent,
    MarkerIconComponent,
    CtgovSourceTagComponent,
    StatusTagComponent,
    RowActionsComponent,
  ],
  templateUrl: './entity-events-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntityEventsSectionComponent {
  readonly spaceId = input.required<string>();
  readonly anchorType = input.required<EventAnchorType>();
  readonly anchorId = input.required<string>();
  readonly events = input.required<Marker[]>();
  readonly description = input('Dated facts and milestones on the timeline.');

  /** Emitted after a create/edit/delete so the parent can reload its events. */
  readonly changed = output<void>();

  protected readonly spaceRole = inject(SpaceRoleService);
  private readonly markerService = inject(MarkerService);
  private readonly landscape = inject(LandscapeStateService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly eventDialogOpen = signal(false);
  protected readonly editingEventId = signal<string | null>(null);
  protected readonly eventDialogMode = computed<'create' | 'edit'>(() =>
    this.editingEventId() ? 'edit' : 'create'
  );
  // ct.gov-owned events open read-only in the merged form (the DB trigger would
  // reject the write); never lock create or analyst-owned events.
  protected readonly editingEventCtgovLocked = computed(() => {
    const id = this.editingEventId();
    if (!id) return false;
    const marker = this.events().find((m) => m.id === id);
    return marker ? isCtgovOwnedMarker(marker) : false;
  });

  private readonly menuCache = new Map<string, MenuItem[]>();
  // Rebuild the row-action menus whenever the events array changes so closures
  // never reference a deleted/stale row.
  private readonly eventsChangeEffect = effect(() => {
    this.events();
    this.menuCache.clear();
  });
  // Reset the edit target whenever the dialog closes so the next "Add event"
  // opens in create mode rather than re-hydrating the last edited event.
  private readonly eventDialogResetEffect = effect(() => {
    if (!this.eventDialogOpen()) this.editingEventId.set(null);
  });

  private readonly queryParamMapSig = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  // ?marker=<id> opens that event in the inline editor (the read-only drawer's
  // "Edit" action round-trips through this param). Guarded so dismissing the
  // dialog with the param still in the URL does not re-open it.
  private lastAppliedMarkerParam: string | null = null;
  private readonly markerEditParamEffect = effect(() => {
    const markerId = this.queryParamMapSig().get('marker');
    if (!markerId) {
      this.lastAppliedMarkerParam = null;
      return;
    }
    if (markerId === this.lastAppliedMarkerParam) return;
    const target = this.events().find((m) => m.id === markerId);
    if (!target) return;
    this.lastAppliedMarkerParam = markerId;
    this.landscape.clearSelection();
    this.editingEventId.set(markerId);
    this.eventDialogOpen.set(true);
  });

  // ?markerId=<id> opens that event in the read-only detail drawer (the
  // repo-wide deep-link convention; a material's MARKER chip links here).
  private lastAppliedMarkerIdParam: string | null = null;
  private readonly markerViewParamEffect = effect(() => {
    const markerId = this.queryParamMapSig().get('markerId');
    if (!markerId) {
      this.lastAppliedMarkerIdParam = null;
      return;
    }
    if (markerId === this.lastAppliedMarkerIdParam) return;
    this.lastAppliedMarkerIdParam = markerId;
    void this.landscape.openMarker(markerId);
  });

  protected openCreate(): void {
    this.editingEventId.set(null);
    this.eventDialogOpen.set(true);
  }

  protected viewMarkerDetail(marker: Marker): void {
    void this.landscape.selectMarker(marker.id);
  }

  // Projected markers render outline, actuals render filled -- mirrors the
  // timeline grid and marker drawer.
  protected markerFillStyle(marker: Marker): 'outline' | 'filled' {
    const projected =
      marker.is_projected || (!!marker.projection && marker.projection !== 'actual');
    return projected ? 'outline' : 'filled';
  }

  protected timelineLabel(marker: Marker): string {
    return timelinePlacementLabel(marker);
  }

  protected timelineTone(marker: Marker): 'brand' | 'slate' {
    return timelinePlacement(marker) === 'timeline' ? 'brand' : 'slate';
  }

  protected markerMenu(marker: Marker): MenuItem[] {
    const key = `marker:${marker.id}`;
    const cached = this.menuCache.get(key);
    if (cached) return cached;
    const items = buildEntityActionMenu({
      canEdit: this.spaceRole.canEdit(),
      editLabel: 'Edit',
      onEdit: () => {
        this.editingEventId.set(marker.id);
        this.eventDialogOpen.set(true);
      },
      onDelete: () => void this.deleteMarker(marker),
    });
    this.menuCache.set(key, items);
    return items;
  }

  protected async onEventSaved(): Promise<void> {
    this.editingEventId.set(null);
    this.eventDialogOpen.set(false);
    this.clearMarkerParam();
    this.changed.emit();
    this.messageService.add({ severity: 'success', summary: 'Event saved.', life: 3000 });
  }

  private async deleteMarker(marker: Marker): Promise<void> {
    // Auto-derived ct.gov markers get re-created on the next sync; surface that
    // so analysts are not surprised by a resurrected event.
    const isCtgovSourced =
      (marker.metadata as { source?: string } | null | undefined)?.source === 'ctgov';
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete event',
      message: isCtgovSourced
        ? 'This event was auto-derived from clinicaltrials.gov. Deleting it removes it now, but the next CT.gov sync may re-create it. To suppress permanently, replace it with a manual event of the same type.'
        : 'Delete this event?',
      requireTypedConfirmation: true,
      typedConfirmationValue: 'delete',
    });
    if (!ok) return;
    try {
      await this.markerService.delete(marker.id);
      this.changed.emit();
      this.messageService.add({ severity: 'success', summary: 'Event deleted.', life: 3000 });
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not delete event',
        detail: e instanceof Error ? e.message : 'Check your connection and try again.',
        life: 4000,
      });
    }
  }

  private clearMarkerParam(): void {
    if (!this.queryParamMapSig().get('marker')) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { marker: null },
      queryParamsHandling: 'merge',
    });
  }
}
