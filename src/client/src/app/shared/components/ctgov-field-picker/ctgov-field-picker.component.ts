import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { CdkDrag, CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';
import { CtgovField } from '../../../core/models/ctgov-field.model';

/**
 * Two-column drag-to-reorder picker for CT.gov fields.
 *
 * Left column: fields available to add (alphabetical).
 * Right column: fields visible on the surface, in display order.
 *
 * Used by the per-space `ctgov_field_visibility` settings UI to choose
 * which CT.gov fields render on each surface (trial-detail, bullseye, etc.)
 * and in what order.
 *
 * `instanceId` must be unique within a single page render. The CDK drag-drop
 * directives match `cdkDropListConnectedTo` against the global cdk drop-list
 * registry; if two pickers share an id (e.g. across p-tabpanel siblings) all
 * drops route to the first registered one and silently drop into a hidden
 * tab.
 */
@Component({
  selector: 'app-ctgov-field-picker',
  standalone: true,
  imports: [CdkDropList, CdkDrag],
  templateUrl: './ctgov-field-picker.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CtgovFieldPickerComponent {
  readonly available = input.required<CtgovField[]>();
  readonly selected = input.required<string[]>();
  readonly instanceId = input.required<string>();
  readonly selectedChange = output<string[]>();

  protected readonly availableListId = computed(() => `available-list-${this.instanceId()}`);
  protected readonly visibleListId = computed(() => `visible-list-${this.instanceId()}`);
  protected readonly availableConnectedTo = computed(() => [this.visibleListId()]);
  protected readonly visibleConnectedTo = computed(() => [this.availableListId()]);

  // Local signal-backed copies of the two list contents.
  // The CDK drag-drop directives mutate the bound array in place, so we keep
  // editable signals seeded from the inputs and push results back via output.
  protected readonly localVisible = signal<CtgovField[]>([]);
  protected readonly localAvailable = signal<CtgovField[]>([]);

  constructor() {
    effect(() => {
      const selectedPaths = this.selected();
      const availablePool = this.available();
      const map = new Map(availablePool.map((f) => [f.path, f]));
      const visibleList = selectedPaths.map((p) => map.get(p)).filter((f): f is CtgovField => !!f);
      const taken = new Set(selectedPaths);
      const availableList = availablePool
        .filter((f) => !taken.has(f.path))
        .sort((a, b) => a.label.localeCompare(b.label));
      this.localVisible.set(visibleList);
      this.localAvailable.set(availableList);
    });
  }

  protected drop(event: CdkDragDrop<CtgovField[]>): void {
    const visible = [...this.localVisible()];
    const available = [...this.localAvailable()];
    const fromVisible = event.previousContainer.id === this.visibleListId();
    const toVisible = event.container.id === this.visibleListId();

    if (event.previousContainer === event.container) {
      if (toVisible) {
        // reorder within visible list
        const [moved] = visible.splice(event.previousIndex, 1);
        visible.splice(event.currentIndex, 0, moved);
      } else {
        // reordering within the available list is a no-op (always alphabetical)
        return;
      }
    } else if (toVisible && !fromVisible) {
      // available -> visible
      const [moved] = available.splice(event.previousIndex, 1);
      visible.splice(event.currentIndex, 0, moved);
    } else if (!toVisible && fromVisible) {
      // visible -> available
      const [moved] = visible.splice(event.previousIndex, 1);
      available.splice(event.currentIndex, 0, moved);
      // resort the available list so order stays alphabetical
      available.sort((a, b) => a.label.localeCompare(b.label));
    }

    this.localVisible.set(visible);
    this.localAvailable.set(available);
    this.selectedChange.emit(visible.map((f) => f.path));
  }
}
