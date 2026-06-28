import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule, ReactiveFormsModule, FormControl, Validators } from '@angular/forms';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';

import { Space } from '../../core/models/space.model';
import { SpaceService } from '../../core/services/space.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { LoaderComponent } from '../../shared/components/loader/loader.component';
import { TopbarStateService } from '../../core/services/topbar-state.service';
import { confirmDelete } from '../../shared/utils/confirm-delete';
import { resolveSpaceBadge } from '../../core/utils/display-fallbacks';

/**
 * Archived spaces list at /t/:tenantId/spaces/archived.
 *
 * Shows all archived spaces in the tenant (RLS-gated). Space owners may
 * restore an archived space; tenant owners and platform admins may
 * permanently delete. Permanently-delete requires type-the-name
 * confirmation to match the friction level of the space-general
 * danger-zone affordance.
 *
 * Cascade-safety #1.
 */
@Component({
  selector: 'app-space-archived-list',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    Dialog,
    InputText,
    MessageModule,
    ManagePageShellComponent,
    RouterLink,
    LoaderComponent,
  ],
  templateUrl: './space-archived-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpaceArchivedListComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private spaceService = inject(SpaceService);
  private supabase = inject(SupabaseService);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  private topbarState = inject(TopbarStateService);

  readonly spaces = signal<Space[]>([]);
  readonly loading = signal(true);
  readonly restoring = signal<string | null>(null);
  readonly deleting = signal(false);
  readonly isTenantOwner = signal(false);
  readonly isPlatformAdmin = signal(false);

  readonly permanentDeleteOpen = signal(false);
  readonly deleteTarget = signal<Space | null>(null);
  readonly typedName = signal('');
  readonly deleteError = signal<string | null>(null);

  readonly typedNameControl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.required],
  });

  readonly canPermanentlyDelete = computed(() => this.isTenantOwner() || this.isPlatformAdmin());

  readonly typedNameMatches = computed(
    () => this.typedName().trim() === (this.deleteTarget()?.name ?? '').trim()
  );

  protected tenantId = '';

  private readonly countEffect = effect(() => {
    this.topbarState.recordCount.set(String(this.spaces().length || ''));
  });

  async ngOnInit(): Promise<void> {
    this.tenantId = this.route.snapshot.paramMap.get('tenantId')!;
    this.typedNameControl.valueChanges.subscribe((value) => {
      this.typedName.set(value ?? '');
    });
    this.topbarState.actions.set([
      {
        label: 'Back to spaces',
        icon: 'fa-solid fa-arrow-left',
        text: true,
        callback: () => this.router.navigate(['/t', this.tenantId, 'spaces']),
      },
    ]);
    await Promise.all([this.loadSpaces(), this.loadAuthorityFlags()]);
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  badge(space: Space) {
    return resolveSpaceBadge({ archivedAt: space.archived_at ?? null });
  }

  async restore(space: Space): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Restore space',
      message: `Restore "${space.name}"?`,
      details: 'The space returns to the active picker and members can edit data again.',
      acceptLabel: 'Restore',
    });
    if (!ok) return;

    this.restoring.set(space.id);
    try {
      await this.spaceService.restoreSpace(space.id);
      this.messageService.add({
        severity: 'success',
        summary: 'Space restored.',
        life: 3000,
      });
      await this.loadSpaces();
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not restore space',
        detail: e instanceof Error ? e.message : 'Please try again.',
        life: 4000,
      });
    } finally {
      this.restoring.set(null);
    }
  }

  openPermanentDelete(space: Space): void {
    if (!this.canPermanentlyDelete()) return;
    this.deleteTarget.set(space);
    this.typedNameControl.reset('');
    this.typedName.set('');
    this.deleteError.set(null);
    this.permanentDeleteOpen.set(true);
  }

  resetPermanentDeleteForm(): void {
    this.typedNameControl.reset('');
    this.typedName.set('');
    this.deleteError.set(null);
    this.deleteTarget.set(null);
  }

  async permanentlyDelete(): Promise<void> {
    const target = this.deleteTarget();
    if (!target) return;
    if (!this.typedNameMatches()) return;
    if (!this.canPermanentlyDelete()) return;

    this.deleting.set(true);
    this.deleteError.set(null);
    try {
      await this.spaceService.permanentlyDeleteSpace(target.id);
      this.permanentDeleteOpen.set(false);
      this.messageService.add({
        severity: 'success',
        summary: `Space "${target.name}" permanently deleted.`,
        life: 3000,
      });
      await this.loadSpaces();
    } catch (e) {
      this.deleteError.set(
        e instanceof Error ? e.message : 'Could not delete space. Please try again.'
      );
    } finally {
      this.deleting.set(false);
    }
  }

  goBack(): void {
    this.router.navigate(['/t', this.tenantId, 'spaces']);
  }

  private async loadSpaces(): Promise<void> {
    this.loading.set(true);
    try {
      const archived = await this.spaceService.listArchivedSpaces(this.tenantId);
      this.spaces.set(archived);
    } catch {
      this.spaces.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadAuthorityFlags(): Promise<void> {
    try {
      const [{ data: tenantOwner }, { data: platformAdmin }] = await Promise.all([
        this.supabase.client.rpc('is_tenant_owner_strict', { p_tenant_id: this.tenantId }),
        this.supabase.client.rpc('is_platform_admin'),
      ]);
      this.isTenantOwner.set(tenantOwner === true);
      this.isPlatformAdmin.set(platformAdmin === true);
    } catch {
      this.isTenantOwner.set(false);
      this.isPlatformAdmin.set(false);
    }
  }
}
