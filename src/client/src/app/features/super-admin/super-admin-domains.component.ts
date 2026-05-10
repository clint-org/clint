import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { MessageService } from 'primeng/api';

import { SuperAdminService, RetiredHostname } from '../../core/services/super-admin.service';
import { StatusTagComponent } from '../../shared/components/status-tag.component';

@Component({
  selector: 'app-super-admin-domains',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    TableModule,
    ButtonModule,
    CheckboxModule,
    Dialog,
    MessageModule,
    StatusTagComponent,
  ],
  template: `
    <div class="p-6">
      <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-base font-semibold text-slate-900">Retired hostnames</h1>
          <p class="mt-1 text-xs text-slate-500">
            Hostnames in the holdback window. They cannot be re-claimed until they are released.
          </p>
        </div>
        <div class="flex items-center gap-2 text-xs text-slate-700">
          <p-checkbox
            inputId="include-expired"
            [ngModel]="includeExpired()"
            (ngModelChange)="includeExpired.set($event)"
            (onChange)="load()"
            [binary]="true"
          />
          <label for="include-expired" class="cursor-pointer"> Include expired (released) </label>
        </div>
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
        [value]="rows()"
        [loading]="loading()"
        [tableStyle]="{ 'min-width': '60rem' }"
        aria-label="Retired hostnames"
      >
        <ng-template #header>
          <tr>
            <th>Hostname</th>
            <th>Previous kind</th>
            <th>Retired</th>
            <th>Released</th>
            <th>Status</th>
            <th>Previous id</th>
            <th class="text-right w-20"><span class="sr-only">Actions</span></th>
          </tr>
        </ng-template>
        <ng-template #body let-row>
          <tr>
            <td class="col-identifier text-xs font-medium text-slate-900">{{ row.hostname }}</td>
            <td>
              <app-status-tag
                [label]="row.previous_kind"
                [tone]="row.previous_kind === 'tenant' ? 'teal' : 'slate'"
              />
            </td>
            <td class="col-identifier text-xs">{{ row.retired_at | date: 'MMM d, y, HH:mm' }}</td>
            <td class="col-identifier text-xs">{{ row.released_at | date: 'MMM d, y, HH:mm' }}</td>
            <td>
              @if (isReleased(row)) {
                <app-status-tag label="released" tone="slate" />
              } @else {
                <app-status-tag label="held" tone="amber" />
              }
            </td>
            <td class="col-identifier text-[10px] text-slate-500">{{ row.previous_id || '--' }}</td>
            <td class="text-right">
              <p-button
                label="Release"
                size="small"
                severity="secondary"
                [outlined]="true"
                [attr.aria-label]="'Release hostname ' + row.hostname"
                (onClick)="openRelease(row)"
              />
            </td>
          </tr>
        </ng-template>
        <ng-template #emptymessage>
          <tr>
            <td colspan="7" class="text-center py-8 text-sm text-slate-500">
              No hostnames are currently in the holdback window.
            </td>
          </tr>
        </ng-template>
      </p-table>
    </div>

    <!-- Release confirmation dialog -->
    <p-dialog
      [(visible)]="releaseDialogOpen"
      [modal]="true"
      [closable]="true"
      [draggable]="false"
      [resizable]="false"
      styleClass="!w-[26rem]"
      header="Release hostname"
      (onHide)="resetRelease()"
    >
      @if (releaseTarget(); as target) {
        <div class="space-y-4">
          <p class="text-sm text-slate-700">
            Release
            <code class="font-mono text-slate-900">{{ target.hostname }}</code>
            from the holdback list. The hostname will be immediately re-claimable via provisioning.
          </p>
          <p class="text-xs text-slate-500">
            Use this only after a deliberate super-admin delete. For real customer decommissions,
            leave the 90-day holdback in place — it prevents takeover via stale session cookies and
            bookmarked links.
          </p>
          @if (releaseError()) {
            <p-message severity="error" [closable]="false">{{ releaseError() }}</p-message>
          }
          <div class="flex items-center justify-end gap-3 pt-2 border-t border-slate-200">
            <p-button
              label="Cancel"
              severity="secondary"
              [outlined]="true"
              type="button"
              (onClick)="releaseDialogOpen = false"
            />
            <p-button
              label="Release"
              severity="danger"
              type="button"
              [loading]="releasing()"
              (onClick)="onConfirmRelease()"
            />
          </div>
        </div>
      }
    </p-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SuperAdminDomainsComponent implements OnInit {
  private readonly service = inject(SuperAdminService);
  private readonly messageService = inject(MessageService);

  readonly rows = signal<RetiredHostname[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  readonly includeExpired = signal(false);

  readonly nowIso = computed(() => new Date().toISOString());

  // Release dialog state
  releaseDialogOpen = false;
  readonly releaseTarget = signal<RetiredHostname | null>(null);
  readonly releasing = signal(false);
  readonly releaseError = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const data = await this.service.listRetiredHostnames(this.includeExpired());
      this.rows.set(data);
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : 'Failed to load retired hostnames.');
    } finally {
      this.loading.set(false);
    }
  }

  isReleased(row: RetiredHostname): boolean {
    return new Date(row.released_at).getTime() <= Date.now();
  }

  openRelease(row: RetiredHostname): void {
    this.releaseTarget.set(row);
    this.releaseError.set(null);
    this.releaseDialogOpen = true;
  }

  resetRelease(): void {
    this.releaseTarget.set(null);
    this.releaseError.set(null);
    this.releasing.set(false);
  }

  async onConfirmRelease(): Promise<void> {
    const target = this.releaseTarget();
    if (!target || this.releasing()) return;
    this.releasing.set(true);
    this.releaseError.set(null);
    try {
      const result = await this.service.releaseRetiredHostname(target.hostname);
      this.messageService.add({
        severity: 'success',
        summary: `Released "${result.hostname}". Available for provisioning immediately.`,
        life: 4000,
      });
      this.releaseDialogOpen = false;
      this.resetRelease();
      await this.load();
    } catch (e) {
      this.releaseError.set(e instanceof Error ? e.message : 'Failed to release hostname.');
    } finally {
      this.releasing.set(false);
    }
  }
}
