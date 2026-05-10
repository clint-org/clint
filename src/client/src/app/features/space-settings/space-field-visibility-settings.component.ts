import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { Tooltip } from 'primeng/tooltip';
import { Tabs, TabList, Tab, TabPanels, TabPanel } from 'primeng/tabs';

import { SpaceFieldVisibilityService } from '../../core/services/space-field-visibility.service';
import { SpaceRoleService } from '../../core/services/space-role.service';
import { CtgovFieldPickerComponent } from '../../shared/components/ctgov-field-picker/ctgov-field-picker.component';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import {
  CTGOV_BULLSEYE_DEFAULT_PATHS,
  CTGOV_DETAIL_DEFAULT_PATHS,
  CTGOV_FIELD_CATALOGUE,
  CTGOV_KEY_CATALYSTS_DEFAULT_PATHS,
  CTGOV_TIMELINE_DEFAULT_PATHS,
  CTGOV_TRIAL_LIST_DEFAULT_PATHS,
} from '../../core/models/ctgov-field.model';

interface SurfaceTab {
  key: string;
  label: string;
  defaults: string[];
}

const SURFACES: SurfaceTab[] = [
  { key: 'trial_detail', label: 'Trial detail', defaults: CTGOV_DETAIL_DEFAULT_PATHS },
  {
    key: 'bullseye_detail_panel',
    label: 'Bullseye detail',
    defaults: CTGOV_BULLSEYE_DEFAULT_PATHS,
  },
  { key: 'timeline_detail', label: 'Timeline detail', defaults: CTGOV_TIMELINE_DEFAULT_PATHS },
  {
    key: 'key_catalysts_panel',
    label: 'Key catalysts',
    defaults: CTGOV_KEY_CATALYSTS_DEFAULT_PATHS,
  },
  { key: 'trial_list_columns', label: 'Trial list', defaults: CTGOV_TRIAL_LIST_DEFAULT_PATHS },
];

@Component({
  selector: 'app-space-field-visibility-settings',
  standalone: true,
  imports: [
    ButtonModule,
    Tooltip,
    Tabs,
    TabList,
    Tab,
    TabPanels,
    TabPanel,
    CtgovFieldPickerComponent,
    ManagePageShellComponent,
    SkeletonComponent,
  ],
  templateUrl: './space-field-visibility-settings.component.html',
})
export class SpaceFieldVisibilitySettingsComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private service = inject(SpaceFieldVisibilityService);
  private messageService = inject(MessageService);
  protected spaceRole = inject(SpaceRoleService);

  readonly catalogue = CTGOV_FIELD_CATALOGUE;
  readonly surfaces = SURFACES;
  readonly canEdit = computed(() => this.spaceRole.isOwner());

  readonly activeTab = signal<string>(SURFACES[0].key);

  /**
   * `p-tabs` emits `valueChange` typed as `string | number` (or `unknown` on
   * older PrimeNG builds). Funnel through a typed handler so the template can
   * stay free of `$any()` and we coerce to the string keys our surfaces use.
   */
  protected onActiveTabChange(value: unknown): void {
    if (typeof value === 'string') this.activeTab.set(value);
  }
  readonly spaceId = signal('');
  readonly loaded = signal<Record<string, string[]>>({});
  readonly draft = signal<Record<string, string[]>>({});
  readonly loading = signal(true);
  readonly saving = signal(false);

  readonly isDirty = computed(() => JSON.stringify(this.loaded()) !== JSON.stringify(this.draft()));

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('spaceId') ?? '';
    this.spaceId.set(id);
    if (id) void this.load(id);
  }

  selectedFor(surfaceKey: string): string[] {
    return this.draft()[surfaceKey] ?? [];
  }

  onSelectedChange(surfaceKey: string, paths: string[]): void {
    this.draft.update((d) => ({ ...d, [surfaceKey]: paths }));
  }

  reset(): void {
    this.draft.set(structuredClone(this.loaded()));
  }

  async save(): Promise<void> {
    if (!this.canEdit()) return;
    this.saving.set(true);
    try {
      await this.service.update(this.spaceId(), this.draft());
      this.loaded.set(structuredClone(this.draft()));
      this.messageService.add({
        severity: 'success',
        summary: 'Field visibility saved.',
        life: 3000,
      });
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not save',
        detail: e instanceof Error ? e.message : 'Check your connection and try again.',
        life: 4000,
      });
    } finally {
      this.saving.set(false);
    }
  }

  private async load(spaceId: string): Promise<void> {
    this.loading.set(true);
    try {
      const visibility = await this.service.get(spaceId);
      // Seed missing surfaces with their defaults so the picker renders
      // something useful on first visit.
      const seeded: Record<string, string[]> = { ...visibility };
      for (const s of this.surfaces) {
        if (!(s.key in seeded)) seeded[s.key] = [...s.defaults];
      }
      this.loaded.set(seeded);
      this.draft.set(structuredClone(seeded));
    } finally {
      this.loading.set(false);
    }
  }
}
