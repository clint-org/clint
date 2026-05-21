import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule, ReactiveFormsModule, FormControl, Validators } from '@angular/forms';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';

import { Space } from '../../core/models/space.model';
import { SpaceService } from '../../core/services/space.service';
import { SpaceRoleService } from '../../core/services/space-role.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { TopbarStateService } from '../../core/services/topbar-state.service';
import { confirmDelete } from '../../shared/utils/confirm-delete';
import { resolveSpaceBadge } from '../../core/utils/display-fallbacks';

/**
 * Space general settings: name + description editing, plus the archive /
 * restore / permanently-delete lifecycle controls.
 *
 * Lifecycle UX (cascade-safety #1):
 *  - Active space + space owner: Archive space (reversible).
 *  - Archived space + space owner: Restore space.
 *  - Archived space + (tenant owner OR platform admin): Permanently delete,
 *    gated by type-the-name confirmation. The button is hidden otherwise
 *    so the affordance never surfaces to roles that cannot use it.
 *
 * Server-side RLS on archive_space / restore_space / permanently_delete_space
 * remains the authoritative gate; this component hides actions to avoid
 * permission-denied toasts.
 */
@Component({
  selector: 'app-space-general',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    InputText,
    Textarea,
    Dialog,
    MessageModule,
    ManagePageShellComponent,
    SkeletonComponent,
  ],
  templateUrl: './space-general.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpaceGeneralComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private spaceService = inject(SpaceService);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  private topbarState = inject(TopbarStateService);
  private supabase = inject(SupabaseService);
  protected spaceRole = inject(SpaceRoleService);

  readonly space = signal<Space | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly archiving = signal(false);
  readonly restoring = signal(false);
  readonly deleting = signal(false);
  readonly name = signal('');
  readonly description = signal('');
  readonly permanentDeleteOpen = signal(false);
  readonly deleteError = signal<string | null>(null);
  readonly typedName = signal('');
  readonly isTenantOwner = signal(false);
  readonly isPlatformAdmin = signal(false);

  /**
   * Reactive form control for the type-the-name input. The actual submit
   * gate uses typedNameMatches() (signal-derived) so the disabled state
   * stays reactive in OnPush components.
   */
  readonly typedNameControl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.required],
  });

  readonly archivedBadge = computed(() =>
    resolveSpaceBadge({ archivedAt: this.space()?.archived_at ?? null })
  );
  readonly isArchived = computed(() => !!this.space()?.archived_at);
  readonly canEditFields = computed(() => this.spaceRole.isOwner() && !this.isArchived());

  readonly canPermanentlyDelete = computed(
    () => this.isArchived() && (this.isTenantOwner() || this.isPlatformAdmin())
  );

  readonly typedNameMatches = computed(
    () => this.typedName().trim() === (this.space()?.name ?? '').trim()
  );

  readonly hasChanges = computed(() => {
    const s = this.space();
    if (!s) return false;
    return (
      this.name().trim() !== s.name ||
      (this.description().trim() || '') !== (s.description || '')
    );
  });

  private tenantId = '';
  private spaceId = '';

  async ngOnInit(): Promise<void> {
    this.tenantId = this.route.snapshot.paramMap.get('tenantId')!;
    this.spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    this.typedNameControl.valueChanges.subscribe((value) => {
      this.typedName.set(value ?? '');
    });
    await Promise.all([this.loadSpace(), this.loadAuthorityFlags()]);
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  async saveIfChanged(): Promise<void> {
    const s = this.space();
    if (!s) return;
    if (!this.hasChanges()) return;
    if (this.isArchived()) return;

    this.saving.set(true);
    try {
      const updated = await this.spaceService.updateSpace(this.spaceId, {
        name: this.name().trim(),
        description: this.description().trim() || null,
      });
      this.space.set(updated);
      this.messageService.add({
        severity: 'success',
        summary: 'Space settings updated.',
        life: 3000,
      });
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not save',
        detail: e instanceof Error ? e.message : 'Please try again.',
        life: 4000,
      });
    } finally {
      this.saving.set(false);
    }
  }

  async confirmArchive(): Promise<void> {
    const s = this.space();
    if (!s) return;
    const ok = await confirmDelete(this.confirmation, {
      header: 'Archive space',
      message: `Archive "${s.name}"?`,
      details:
        'The space is hidden from the picker and read-only until restored. A space owner can restore it at any time.',
      acceptLabel: 'Archive',
    });
    if (!ok) return;

    this.archiving.set(true);
    try {
      await this.spaceService.archiveSpace(this.spaceId);
      const updated = await this.spaceService.getSpace(this.spaceId);
      this.space.set(updated);
      this.messageService.add({
        severity: 'success',
        summary: 'Space archived.',
        detail: 'Restore from this page at any time.',
        life: 3000,
      });
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not archive space',
        detail: e instanceof Error ? e.message : 'Please try again.',
        life: 4000,
      });
    } finally {
      this.archiving.set(false);
    }
  }

  async confirmRestore(): Promise<void> {
    const s = this.space();
    if (!s) return;
    const ok = await confirmDelete(this.confirmation, {
      header: 'Restore space',
      message: `Restore "${s.name}"?`,
      details: 'The space returns to the active picker and members can edit data again.',
      acceptLabel: 'Restore',
    });
    if (!ok) return;

    this.restoring.set(true);
    try {
      await this.spaceService.restoreSpace(this.spaceId);
      const updated = await this.spaceService.getSpace(this.spaceId);
      this.space.set(updated);
      this.messageService.add({
        severity: 'success',
        summary: 'Space restored.',
        life: 3000,
      });
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not restore space',
        detail: e instanceof Error ? e.message : 'Please try again.',
        life: 4000,
      });
    } finally {
      this.restoring.set(false);
    }
  }

  openPermanentDeleteDialog(): void {
    if (!this.canPermanentlyDelete()) return;
    this.resetPermanentDeleteForm();
    this.permanentDeleteOpen.set(true);
  }

  resetPermanentDeleteForm(): void {
    this.typedNameControl.reset('');
    this.typedName.set('');
    this.deleteError.set(null);
  }

  async permanentlyDelete(): Promise<void> {
    if (!this.typedNameMatches()) return;
    if (!this.canPermanentlyDelete()) return;

    this.deleting.set(true);
    this.deleteError.set(null);
    try {
      await this.spaceService.permanentlyDeleteSpace(this.spaceId);
      this.permanentDeleteOpen.set(false);
      this.messageService.add({
        severity: 'success',
        summary: 'Space permanently deleted.',
        life: 3000,
      });
      this.router.navigate(['/t', this.tenantId, 'spaces']);
    } catch (e) {
      this.deleteError.set(
        e instanceof Error ? e.message : 'Could not delete space. Please try again.'
      );
    } finally {
      this.deleting.set(false);
    }
  }

  private async loadSpace(): Promise<void> {
    this.loading.set(true);
    try {
      const space = await this.spaceService.getSpace(this.spaceId);
      this.space.set(space);
      this.name.set(space.name);
      this.description.set(space.description ?? '');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadAuthorityFlags(): Promise<void> {
    // Best-effort: failures default to false (Permanently delete stays
    // hidden). RLS is the authoritative gate on the RPC itself.
    try {
      const tenantId = this.route.snapshot.paramMap.get('tenantId');
      if (!tenantId) {
        this.isTenantOwner.set(false);
        this.isPlatformAdmin.set(false);
        return;
      }
      const [{ data: tenantOwner }, { data: platformAdmin }] = await Promise.all([
        this.supabase.client.rpc('is_tenant_owner_strict', { p_tenant_id: tenantId }),
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
