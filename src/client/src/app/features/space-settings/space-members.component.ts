import { Component, computed, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { Select } from 'primeng/select';
import { InputText } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';

import { SpaceMember, SpaceInvite } from '../../core/models/space.model';
import { SpaceRoleService } from '../../core/services/space-role.service';
import { SpaceService } from '../../core/services/space.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { RowActionsComponent } from '../../shared/components/row-actions.component';
import { StatusTagComponent } from '../../shared/components/status-tag.component';
import { TableSkeletonBodyComponent } from '../../shared/components/skeleton/table-skeleton-body.component';
import { confirmDelete } from '../../shared/utils/confirm-delete';
import { TopbarStateService } from '../../core/services/topbar-state.service';

type SpaceRole = 'owner' | 'editor' | 'viewer';

const ROLE_LABEL: Record<SpaceRole, string> = {
  owner: 'Owner',
  editor: 'Contributor',
  viewer: 'Reader',
};

@Component({
  selector: 'app-space-members',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    TableModule,
    ButtonModule,
    Dialog,
    Select,
    InputText,
    MessageModule,
    ManagePageShellComponent,
    RowActionsComponent,
    StatusTagComponent,
    TableSkeletonBodyComponent,
    RouterLink,
  ],
  template: `
    <app-manage-page-shell>

      <p class="mb-4 text-[11px] text-slate-500 max-w-2xl">
        Space members can see and (with Contributor or Owner role) edit data in
        this space. Invite anyone by email, agency colleagues or pharma client
        users. Owners can manage members; Contributors can edit data; Readers
        have read-only access.
        <a
          [routerLink]="rolesHelpLink()"
          class="ml-1 text-brand-700 hover:underline"
        >Roles and permissions</a>.
      </p>

      <p-table
        styleClass="data-table"
        [value]="members()"
        [loading]="loading()"
        [tableStyle]="{ 'min-width': '48rem' }"
        aria-label="Space members"
      >
        <ng-template #header>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th class="col-actions"></th>
          </tr>
        </ng-template>
        <ng-template #body let-member>
          <tr>
            <td>{{ member.display_name }}</td>
            <td class="col-identifier">{{ member.email }}</td>
            <td>
              @if (!isSelf(member) && spaceRole.isOwner()) {
                <p-select
                  [options]="roleOptions"
                  [ngModel]="member.role"
                  (ngModelChange)="changeRole(member, $event)"
                  optionLabel="label"
                  optionValue="value"
                  size="small"
                  [style]="{ minWidth: '8rem' }"
                />
              } @else {
                <app-status-tag
                  [label]="roleLabel(member.role)"
                  [tone]="member.role === 'owner' ? 'teal' : 'slate'"
                />
              }
            </td>
            <td class="col-actions">
              @if (!isSelf(member) && spaceRole.isOwner()) {
                <app-row-actions
                  [items]="memberMenu(member)"
                  [ariaLabel]="'Actions for ' + member.display_name"
                />
              }
            </td>
          </tr>
        </ng-template>
        <ng-template #loadingbody>
          <app-table-skeleton-body
            [cells]="[
              { w: '52%' },
              { w: '64%', h: '11px' },
              { w: '88px', h: '14px' },
              { w: '14px', class: 'col-actions' },
            ]"
          />
        </ng-template>
        <ng-template #emptymessage>
          <tr>
            <td colspan="4">No members.</td>
          </tr>
        </ng-template>
      </p-table>

      <!-- Pending invites: owner-only (invite codes are sensitive) -->
      @if (spaceRole.isOwner()) {
      <div class="mt-10 mb-3 flex items-baseline justify-between">
        <h2 class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          Pending invites
        </h2>
        <span class="text-[11px] text-slate-400 tabular-nums">{{ invites().length }}</span>
      </div>
      <p-table
        styleClass="data-table"
        [value]="invites()"
        [tableStyle]="{ 'min-width': '40rem' }"
        aria-label="Pending invites"
      >
        <ng-template #header>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Code</th>
            <th>Expires</th>
            <th class="col-actions"></th>
          </tr>
        </ng-template>
        <ng-template #body let-invite>
          <tr>
            <td>{{ invite.email }}</td>
            <td>
              <app-status-tag
                [label]="roleLabel(invite.role)"
                [tone]="invite.role === 'owner' ? 'teal' : 'slate'"
              />
            </td>
            <td class="col-identifier">{{ invite.invite_code }}</td>
            <td class="col-identifier">{{ invite.expires_at | date: 'MMM d, y' }}</td>
            <td class="col-actions">
              <app-row-actions
                [items]="inviteMenu(invite)"
                [ariaLabel]="'Actions for invite ' + invite.email"
              />
            </td>
          </tr>
        </ng-template>
        <ng-template #emptymessage>
          <tr>
            <td colspan="5">No pending invites.</td>
          </tr>
        </ng-template>
      </p-table>
      }
    </app-manage-page-shell>

    <!-- Invite dialog -->
    <p-dialog
      header="Invite to space"
      [(visible)]="addDialogOpen"
      [modal]="true"
      [style]="{ width: '32rem' }"
      (onHide)="resetInviteForm()"
    >
      <p class="mb-3 text-xs text-slate-500">
        Invite by email. Existing users are added immediately; otherwise an invite
        code is held for them to accept after sign-in.
      </p>
      <div class="mb-3">
        <label for="invite-email" class="mb-1 block text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          pInputText
          id="invite-email"
          class="w-full"
          type="email"
          [ngModel]="inviteEmail()"
          (ngModelChange)="inviteEmail.set($event)"
          name="email"
          required
        />
      </div>
      <div>
        <div class="mb-1 flex items-baseline justify-between">
          <label for="invite-role" class="block text-sm font-medium text-slate-700">
            Role
          </label>
          <a
            [routerLink]="rolesHelpLink()"
            class="text-[11px] text-brand-700 hover:underline"
          >What does each role mean?</a>
        </div>
        <p-select
          inputId="invite-role"
          [options]="roleOptions"
          [ngModel]="inviteRole()"
          (ngModelChange)="inviteRole.set($event)"
          optionLabel="label"
          optionValue="value"
          [style]="{ width: '100%' }"
        />
      </div>
      @if (inviteResult()) {
        <p-message severity="success" [closable]="false" styleClass="mt-3">
          {{ inviteResult() }}
        </p-message>
      }
      @if (inviteError()) {
        <p-message severity="error" [closable]="false" styleClass="mt-3">
          {{ inviteError() }}
        </p-message>
      }
      <ng-template #footer>
        <p-button
          label="Close"
          severity="secondary"
          [outlined]="true"
          (onClick)="addDialogOpen.set(false)"
        />
        <p-button
          label="Send invite"
          (onClick)="sendInvite()"
          [loading]="adding()"
          [disabled]="!inviteEmail().trim()"
        />
      </ng-template>
    </p-dialog>
  `,
})
export class SpaceMembersComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private spaceService = inject(SpaceService);
  private supabase = inject(SupabaseService);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  private topbarState = inject(TopbarStateService);
  protected spaceRole = inject(SpaceRoleService);

  // Surface the Invite topbar action only for owners. The effect re-runs
  // when isOwner() flips (initial fetch resolves, or the user navigates
  // between spaces with different roles).
  private readonly topbarActionsEffect = effect(() => {
    if (this.spaceRole.isOwner()) {
      this.topbarState.actions.set([
        {
          label: 'Invite to space',
          icon: 'fa-solid fa-user-plus',
          text: true,
          callback: () => this.openInviteDialog(),
        },
      ]);
    } else {
      this.topbarState.actions.set([]);
    }
  });

  private readonly menuCache = new Map<string, MenuItem[]>();
  private readonly inviteMenuCache = new Map<string, MenuItem[]>();

  members = signal<SpaceMember[]>([]);
  invites = signal<SpaceInvite[]>([]);
  loading = signal(true);
  addDialogOpen = signal(false);
  adding = signal(false);
  readonly inviteEmail = signal('');
  readonly inviteRole = signal<SpaceRole>('viewer');
  readonly inviteResult = signal<string | null>(null);
  readonly inviteError = signal<string | null>(null);

  private spaceId = '';
  private tenantId = '';

  rolesHelpLink(): string[] {
    return ['/t', this.tenantId, 'help', 'roles'];
  }

  readonly roleOptions = [
    { label: ROLE_LABEL.owner, value: 'owner' as SpaceRole },
    { label: ROLE_LABEL.editor, value: 'editor' as SpaceRole },
    { label: ROLE_LABEL.viewer, value: 'viewer' as SpaceRole },
  ];

  readonly currentUserIsOwner = computed(() => {
    const userId = this.supabase.currentUser()?.id;
    if (!userId) return false;
    return this.members().some((m) => m.user_id === userId && m.role === 'owner');
  });

  roleLabel(role: SpaceRole): string {
    return ROLE_LABEL[role] ?? role;
  }

  async ngOnInit(): Promise<void> {
    this.tenantId = this.route.snapshot.paramMap.get('tenantId')!;
    this.spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    await this.loadData();
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  isSelf(member: SpaceMember): boolean {
    return member.user_id === this.supabase.currentUser()?.id;
  }

  memberMenu(member: SpaceMember): MenuItem[] {
    const cached = this.menuCache.get(member.user_id);
    if (cached) return cached;
    const items: MenuItem[] = [
      {
        label: 'Remove from space',
        icon: 'fa-solid fa-user-minus',
        styleClass: 'row-actions-danger',
        command: () => this.removeMember(member),
      },
    ];
    this.menuCache.set(member.user_id, items);
    return items;
  }

  inviteMenu(invite: SpaceInvite): MenuItem[] {
    const cached = this.inviteMenuCache.get(invite.id);
    if (cached) return cached;
    const items: MenuItem[] = [
      {
        label: 'Revoke invite',
        icon: 'fa-solid fa-trash',
        styleClass: 'row-actions-danger',
        command: () => this.revokeInvite(invite),
      },
    ];
    this.inviteMenuCache.set(invite.id, items);
    return items;
  }

  async changeRole(member: SpaceMember, newRole: SpaceRole): Promise<void> {
    try {
      await this.spaceService.updateMemberRole(this.spaceId, member.user_id, newRole);
      await this.loadData();
      this.messageService.add({ severity: 'success', summary: 'Role updated.', life: 3000 });
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not update role',
        detail: e instanceof Error ? e.message : 'Please try again.',
        life: 4000,
      });
    }
  }

  async removeMember(member: SpaceMember): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Remove member',
      message: `Remove ${member.display_name ?? member.email} from this space?`,
      acceptLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await this.spaceService.removeMember(this.spaceId, member.user_id);
      await this.loadData();
      this.messageService.add({ severity: 'success', summary: 'Member removed.', life: 3000 });
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not remove member',
        detail: e instanceof Error ? e.message : 'Please try again.',
        life: 4000,
      });
    }
  }

  openInviteDialog(): void {
    this.resetInviteForm();
    this.addDialogOpen.set(true);
  }

  resetInviteForm(): void {
    this.inviteEmail.set('');
    this.inviteRole.set('viewer');
    this.inviteResult.set(null);
    this.inviteError.set(null);
  }

  async sendInvite(): Promise<void> {
    const email = this.inviteEmail().trim();
    if (!email) return;
    this.adding.set(true);
    this.inviteResult.set(null);
    this.inviteError.set(null);
    try {
      const result = await this.spaceService.inviteToSpace(this.spaceId, email, this.inviteRole());
      if (result.invited) {
        this.inviteResult.set(`Invite held for ${email}. Code: ${result.invite_code}`);
      } else {
        this.inviteResult.set(`${email} added to space.`);
      }
      await this.loadData();
      this.inviteEmail.set('');
    } catch (e) {
      this.inviteError.set(e instanceof Error ? e.message : 'Failed to invite');
    } finally {
      this.adding.set(false);
    }
  }

  async revokeInvite(invite: SpaceInvite): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Revoke invite',
      message: `Revoke the pending invite for ${invite.email}?`,
      acceptLabel: 'Revoke',
    });
    if (!ok) return;
    try {
      await this.spaceService.deleteInvite(invite.id);
      await this.loadData();
      this.messageService.add({ severity: 'success', summary: 'Invite revoked.', life: 3000 });
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not revoke invite',
        detail: e instanceof Error ? e.message : 'Please try again.',
        life: 4000,
      });
    }
  }

  private async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      const [membersResult, invitesResult] = await Promise.allSettled([
        this.spaceService.listMembers(this.spaceId),
        this.spaceService.listInvites(this.spaceId),
      ]);

      if (membersResult.status === 'fulfilled') {
        this.members.set(membersResult.value);
      } else {
        console.error('space-members: failed to load members', membersResult.reason);
      }

      if (invitesResult.status === 'fulfilled') {
        this.invites.set(invitesResult.value);
      } else {
        // RLS blocks invites read for non-owners; that's expected, surface nothing.
        this.invites.set([]);
      }

      this.menuCache.clear();
      this.inviteMenuCache.clear();
    } finally {
      this.loading.set(false);
    }
  }
}
