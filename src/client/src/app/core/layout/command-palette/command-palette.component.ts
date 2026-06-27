import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  effect,
  inject,
  input,
  computed,
} from '@angular/core';
import { Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { PaletteService } from '../../services/palette.service';
import { PaletteHotkeyService } from '../../services/palette-hotkey.service';
import { PaletteCommandRegistry } from '../../services/palette-command.registry';
import { PaletteRecentsService } from '../../services/palette-recents.service';
import { PalettePinService } from '../../services/palette-pin.service';
import { PaletteSearchInputComponent } from './palette-search-input.component';
import { PaletteEmptyStateComponent } from './palette-empty-state.component';
import { PaletteResultListComponent } from './palette-result-list.component';
import { PaletteEntityItem, PaletteItem, PaletteKind } from '../../models/palette.model';

@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [PaletteSearchInputComponent, PaletteEmptyStateComponent, PaletteResultListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hotkey.isOpen()) {
      <div
        class="fixed inset-0 z-[1000]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="palette-title"
      >
        <button
          type="button"
          aria-label="Close palette"
          class="absolute inset-0 cursor-default bg-slate-900/50 backdrop-blur-sm"
          (click)="close()"
        ></button>
        <div
          class="absolute left-1/2 top-[15vh] flex max-h-[70vh] w-[720px] max-w-[92vw] -translate-x-1/2 flex-col rounded-md border border-slate-200 bg-white shadow-2xl"
        >
          <h2 id="palette-title" class="sr-only">Search</h2>
          <app-palette-search-input
            [query]="palette.query()"
            [parsed]="palette.parsedQuery()"
            [scope]="palette.scope()"
            [scopeName]="spaceName()"
            [activeDescendantId]="activeDescendantId()"
            (queryChange)="palette.setQuery($event)"
            (arrow)="onArrow($event)"
            (enter)="onEnter($event.withModifier)"
            (escape)="close()"
            (tab)="toggleScope()"
            (togglePin)="togglePinOnSelected()"
          />
          <div class="relative min-h-0 flex-1">
            <div class="h-full overflow-y-auto">
              @if (palette.query().length === 0) {
                <app-palette-empty-state
                  [state]="palette.emptyState()"
                  [selectedFlatIndex]="palette.selectedIndex()"
                  (indexSelect)="palette.selectIndex($event)"
                  (activated)="onActivate($event)"
                />
              } @else {
                <app-palette-result-list
                  [items]="palette.results()"
                  [selectedIndex]="palette.selectedIndex()"
                  [loading]="palette.isLoading()"
                  [scopeLabel]="spaceName()"
                  (indexSelect)="palette.selectIndex($event)"
                  (activated)="onActivate($event)"
                />
              }
              <!-- Clearance equal to the fade height so the last row can scroll
                   fully clear of the dissolve instead of being washed into the footer. -->
              <div class="h-6" aria-hidden="true"></div>
            </div>
            <!-- Bottom scroll fade so the list dissolves instead of cutting a row flat. -->
            <div
              class="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-white to-transparent"
              aria-hidden="true"
            ></div>
          </div>
          <footer
            class="flex items-center gap-x-4 gap-y-1 overflow-hidden border-t border-slate-100 px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-slate-400"
          >
            <span class="whitespace-nowrap"
              ><kbd class="text-slate-500">&uarr;&darr;</kbd> Navigate</span
            >
            <span class="whitespace-nowrap"><kbd class="text-slate-500">&crarr;</kbd> Open</span>
            <span class="whitespace-nowrap"><kbd class="text-slate-500">Tab</kbd> Scope</span>
            <span class="ml-auto whitespace-nowrap"
              ><kbd class="text-slate-500">Esc</kbd> Close</span
            >
          </footer>
          <div class="sr-only" aria-live="polite">{{ liveMessage() }}</div>
        </div>
      </div>
    }
  `,
})
export class CommandPaletteComponent implements OnInit {
  readonly palette = inject(PaletteService);
  readonly hotkey = inject(PaletteHotkeyService);
  private readonly registry = inject(PaletteCommandRegistry);
  private readonly recents = inject(PaletteRecentsService);
  private readonly pins = inject(PalettePinService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly spaceName = input<string>('');
  private spaceId: string | null = null;
  private tenantId: string | null = null;

  readonly liveMessage = computed(() => {
    const n = this.palette.results().length;
    return this.palette.query().length === 0 ? '' : `${n} ${n === 1 ? 'result' : 'results'}`;
  });

  readonly activeDescendantId = computed(() => {
    const i = this.palette.selectedIndex();
    return this.palette.query().length === 0 || this.palette.results().length === 0
      ? null
      : `palette-row-${i}`;
  });

  // effect() must run in injection context; field initializer is valid.
  private readonly _syncOpen = effect(() => {
    if (this.hotkey.isOpen() && this.spaceId) {
      this.palette.open(this.spaceId);
    } else if (!this.hotkey.isOpen()) {
      this.palette.close();
    }
  });

  ngOnInit(): void {
    this.recents.init();
    this.palette.setCommandsProvider(() => {
      if (!this.tenantId || !this.spaceId) return [];
      return this.registry.list(this.tenantId, this.spaceId);
    });

    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.captureRouteContext();
      this.close();
    });
    this.captureRouteContext();
  }

  private captureRouteContext() {
    let r: ActivatedRoute | null = this.route;
    let tenantId: string | null = null;
    let spaceId: string | null = null;
    while (r) {
      const ps = r.snapshot.paramMap;
      if (ps.has('tenantId')) tenantId = ps.get('tenantId');
      if (ps.has('spaceId')) spaceId = ps.get('spaceId');
      r = r.firstChild;
    }
    this.tenantId = tenantId;
    this.spaceId = spaceId;
  }

  close() {
    this.hotkey.close();
  }

  toggleScope() {
    this.palette.scope.update((s) => (s === 'space' ? 'all-spaces' : 'space'));
  }

  onArrow(dir: 'up' | 'down' | 'home' | 'end') {
    if (dir === 'up') this.palette.moveSelection(-1);
    if (dir === 'down') this.palette.moveSelection(+1);
    if (dir === 'home') this.palette.selectIndex(0);
    if (dir === 'end') this.palette.selectIndex(this.palette.results().length - 1);
  }

  onEnter(withModifier: boolean) {
    const sel = this.palette.selectedItem();
    if (!sel) return;
    void this.activate(sel, withModifier);
  }

  onActivate(payload: { index: number; item: PaletteItem }) {
    void this.activate(payload.item, false);
  }

  private async activate(item: PaletteItem, withModifier: boolean) {
    if (item.kind === 'command') {
      this.close();
      await item.command.run();
      return;
    }
    const url = this.urlForEntity(item);
    if (!url) return;
    if (withModifier) {
      window.open(url, '_blank', 'noopener');
      this.close();
    } else {
      this.close();
      await this.router.navigateByUrl(url);
    }
    if (this.spaceId) {
      void this.recents.touch({ kind: item.kind, spaceId: this.spaceId, entityId: item.id });
    }
  }

  togglePinOnSelected() {
    const sel = this.palette.selectedItem();
    if (!sel || sel.kind === 'command' || !this.spaceId) return;
    void this.pins.toggle(this.spaceId, sel as PaletteEntityItem);
  }

  private urlForEntity(item: { kind: PaletteKind; id: string }): string | null {
    if (!this.tenantId || !this.spaceId) return null;
    const base = `/t/${this.tenantId}/s/${this.spaceId}`;
    switch (item.kind) {
      case 'trial':
        return `${base}/profiles/trials/${item.id}`;
      case 'company':
        return `${base}/profiles/companies/${item.id}`;
      case 'asset':
        return `${base}/profiles/assets/${item.id}`;
      case 'event':
        return `${base}/events?eventId=${item.id}`;
      case 'catalyst':
        return `${base}/catalysts?markerId=${item.id}`;
    }
  }
}
