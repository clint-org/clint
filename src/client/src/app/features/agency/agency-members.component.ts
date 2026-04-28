import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { MessageModule } from 'primeng/message';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';

import { AgencyService } from '../../core/services/agency.service';
import { Agency, AgencyMember } from '../../core/models/agency.model';
import { BrandContextService } from '../../core/services/brand-context.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { RowActionsComponent } from '../../shared/components/row-actions.component';
import { StatusTagComponent } from '../../shared/components/status-tag.component';
import { confirmDelete } from '../../shared/utils/confirm-delete';

@Component({
  selector: 'app-agency-members',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    ButtonModule,
    TableModule,
    Dialog,
    InputText,
    Select,
    MessageModule,
    ManagePageShellComponent,
    RowActionsComponent,
    StatusTagComponent,
  ],
  template: `
    <app-manage-page-shell>
      <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-base font-semibold text-slate-900">Members</h1>
          <p class="mt-1 text-xs text-slate-500">
            Users who can act on behalf of this agency. Owners can provision tenants and edit
            agency or tenant branding.
          </p>
        </div>
        <p-button
          label="Add member"
          icon="fa-solid fa-user-plus"
          size="small"
          (onClick)="openAddDialog()"
          [disabled]="!isOwner()"
        />
      </div>

      @if (loadError()) {
        <p-message
          severity="error"
          [closable]="true"
          (onClose)="loadError.set(null)"
          styleClass="mb-4"
        >
          {{ loadError() }}
        </p-message>
      }

      <p-table
        styleClass="data-table"
        [value]="members()"
        [loading]="loading()"
        [tableStyle]="{ 'min-width': '48rem' }"
        aria-label="Agency members"
      >
        <ng-template #header>
          <tr>
            <th>Name</th>
            <th>Email / User</th>
            <th>Role</th>
            <th>Joined</th>
            <th class="col-actions"></th>
          </tr>
        </ng-template>
        <ng-template #body let-member>
          <tr>
            <td>{{ member.display_name || '--' }}</td>
            <td class="col-identifier">{{ member.email || member.user_id }}</td>
            <td>
              @if (isOwner() && !isSelf(member)) {
                <p-select
                  [options]="roleOptions"
                  [ngModel]="member.role"
                  (ngModelChange)="changeRole(member, $event)"
                  optionLabel="label"
                  optionValue="value"
                  size="small"
                  [style]="{ minWidth: '7rem' }"
                />
              } @else {
                <app-status-tag
                  [label]="member.role"
                  [tone]="member.role === 'owner' ? 'teal' : 'slate'"
                />
              }
            </td>
            <td class="col-identifier text-xs">
              {{ member.created_at | date: 'MMM d, y' }}
            </td>
            <td class="col-actions">
              @if (isOwner() && !isSelf(member)) {
                <app-row-actions
                  [items]="memberMenu(member)"
                  [ariaLabel]="'Actions for ' + (member.display_name || member.email || member.user_id)"
                />
              }
            </td>
          </tr>
        </ng-template>
        <ng-template #emptymessage>
          <tr>
            <td colspan="5" class="text-center py-6 text-sm text-slate-500">
              No agency members.
            </td>
          </tr>
        </ng-template>
      </p-table>
    </app-manage-page-shell>

    <p-dialog
      header="Add agency member"
      [(visible)]="addDialogOpen"
      [modal]="true"
      [style]="{ width: '32rem' }"
      (onHide)="resetAddForm()"
    >
      <form (ngSubmit)="onAdd()" class="space-y-4">
        <p class="text-xs text-slate-500">
          Enter the email of an existing user. They must already have signed in to the platform
          before they can be added.
        </p>
        <div>
          <label for="add-email" class="mb-1 block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            pInputText
            id="add-email"
            type="email"
            autocomplete="off"
            class="w-full text-sm"
            [ngModel]="newEmail()"
            (ngModelChange)="newEmail.set($event)"
            name="email"
            placeholder="user@example.com"
            (blur)="onEmailBlur()"
            required
          />
          @if (lookingUp()) {
            <p class="mt-1 text-xs text-slate-500">Looking up user&hellip;</p>
          }
          @if (resolvedUser()) {
            <p class="mt-1 text-xs text-slate-600">
              Found: <strong>{{ resolvedUser()!.display_name }}</strong>
            </p>
          }
          @if (lookupError()) {
            <p class="mt-1 text-xs text-rose-700">{{ lookupError() }}</p>
          }
        </div>
        <div>
          <label for="add-role" class="mb-1 block text-sm font-medium text-slate-700">Role</label>
          <p-select
            inputId="add-role"
            [options]="roleOptions"
            [ngModel]="newRole()"
            (ngModelChange)="newRole.set($event)"
            name="role"
            optionLabel="label"
            optionValue="value"
            [style]="{ width: '100%' }"
          />
        </div>
        @if (addError()) {
          <p-message severity="error" [closable]="false">{{ addError() }}</p-message>
        }
      </form>
      <ng-template #footer>
        <p-button
          label="Cancel"
          severity="secondary"
          [outlined]="true"
          (onClick)="addDialogOpen.set(false)"
        />
        <p-button
          label="Add member"
          (onClick)="onAdd()"
          [loading]="adding()"
          [disabled]="!resolvedUser() || adding()"
        />
      </ng-template>
    </p-dialog>
  `,
})
export class AgencyMembersComponent implements OnInit {
  private readonly agencyService = inject(AgencyService);
  private readonly supabase = inject(SupabaseService);
  private readonly brand = inject(BrandContextService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);

  readonly agency = signal<Agency | null>(null);
  readonly members = signal<AgencyMember[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly addDialogOpen = signal(false);
  readonly adding = signal(false);
  readonly addError = signal<string | null>(null);

  readonly newEmail = signal('');
  readonly newRole = signal<'owner' | 'member'>('member');
  readonly resolvedUser = signal<{ user_id: string; display_name: string } | null>(null);
  readonly lookingUp = signal(false);
  readonly lookupError = signal<string | null>(null);
  private lookupSeq = 0;

  readonly roleOptions = [
    { label: 'Owner', value: 'owner' },
    { label: 'Member', value: 'member' },
  ];

  readonly currentUserId = computed(() => this.supabase.currentUser()?.id ?? null);
  readonly isOwner = computed(() => {
    const uid = this.currentUserId();
    if (!uid) return false;
    return this.members().some((m) => m.user_id === uid && m.role === 'owner');
  });

  // Stable MenuItem refs per member id (PrimeNG popup menus drop the first
  // click otherwise — see CompanyListComponent comment).
  private readonly menuCache = new Map<string, MenuItem[]>();

  async ngOnInit(): Promise<void> {
    await this.loadAll();
  }

  isSelf(member: AgencyMember): boolean {
    return member.user_id === this.currentUserId();
  }

  memberMenu(member: AgencyMember): MenuItem[] {
    const cached = this.menuCache.get(member.id);
    if (cached) return cached;
    const items: MenuItem[] = [
      {
        label: 'Remove member',
        icon: 'fa-solid fa-user-minus',
        styleClass: 'row-actions-danger',
        command: () => this.confirmRemove(member),
      },
    ];
    this.menuCache.set(member.id, items);
    return items;
  }

  openAddDialog(): void {
    this.resetAddForm();
    this.addDialogOpen.set(true);
  }

  resetAddForm(): void {
    this.newEmail.set('');
    this.newRole.set('member');
    this.addError.set(null);
    this.resolvedUser.set(null);
    this.lookupError.set(null);
    this.lookingUp.set(false);
  }

  async onEmailBlur(): Promise<void> {
    const email = this.newEmail().trim();
    this.resolvedUser.set(null);
    this.lookupError.set(null);
    if (!email) return;
    const seq = ++this.lookupSeq;
    this.lookingUp.set(true);
    try {
      const found = await this.agencyService.lookupUserByEmail(email);
      // Drop stale results if user typed again before the previous call returned.
      if (seq !== this.lookupSeq) return;
      if (found) {
        this.resolvedUser.set(found);
      } else {
        this.lookupError.set(
          'No user found with that email. Send them an invite to join first.'
        );
      }
    } catch (e) {
      if (seq !== this.lookupSeq) return;
      this.lookupError.set(e instanceof Error ? e.message : 'Lookup failed.');
    } finally {
      if (seq === this.lookupSeq) this.lookingUp.set(false);
    }
  }

  async onAdd(): Promise<void> {
    const a = this.agency();
    if (!a) return;
    const resolved = this.resolvedUser();
    if (!resolved) {
      this.addError.set('Resolve the email to a user before adding.');
      return;
    }
    this.adding.set(true);
    this.addError.set(null);
    try {
      await this.agencyService.addAgencyMember(a.id, resolved.user_id, this.newRole());
      this.addDialogOpen.set(false);
      this.resetAddForm();
      this.messageService.add({ severity: 'success', summary: 'Member added.', life: 3000 });
      await this.loadAll();
    } catch (e) {
      this.addError.set(e instanceof Error ? e.message : 'Failed to add member.');
    } finally {
      this.adding.set(false);
    }
  }

  async changeRole(member: AgencyMember, role: 'owner' | 'member'): Promise<void> {
    if (member.role === role) return;
    try {
      await this.agencyService.updateAgencyMemberRole(member.id, role);
      this.messageService.add({ severity: 'success', summary: 'Role updated.', life: 3000 });
      await this.loadAll();
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Failed to update role',
        detail: e instanceof Error ? e.message : String(e),
        life: 4000,
      });
    }
  }

  async confirmRemove(member: AgencyMember): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Remove member',
      message: `Remove ${member.display_name || member.email || member.user_id} from this agency?`,
      acceptLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await this.agencyService.removeAgencyMember(member.id);
      this.messageService.add({ severity: 'success', summary: 'Member removed.', life: 3000 });
      await this.loadAll();
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Failed to remove member',
        detail: e instanceof Error ? e.message : String(e),
        life: 4000,
      });
    }
  }

  private async loadAll(): Promise<void> {
    this.loading.set(true);
    try {
      if (!this.agency()) {
        const agencies = await this.agencyService.listMyAgencies();
        const brandId = this.brand.brand().id;
        const match = brandId ? agencies.find((a) => a.id === brandId) : null;
        const current = match ?? agencies[0] ?? null;
        this.agency.set(current);
        if (!current) {
          this.loadError.set('No agency available for this account.');
          this.members.set([]);
          return;
        }
      }
      const a = this.agency();
      if (!a) return;
      const members = await this.agencyService.listAgencyMembers(a.id);
      this.members.set(members);
      this.menuCache.clear();
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : 'Failed to load members.');
    } finally {
      this.loading.set(false);
    }
  }
}
