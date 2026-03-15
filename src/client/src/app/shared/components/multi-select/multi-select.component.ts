import {
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';

export interface MultiSelectOption {
  id: string;
  name: string;
}

@Component({
  selector: 'app-multi-select',
  standalone: true,
  templateUrl: './multi-select.component.html',
})
export class MultiSelectComponent {
  label = input.required<string>();
  options = input.required<MultiSelectOption[]>();
  selected = input<string[]>([]);

  selectionChange = output<string[]>();

  isOpen = signal(false);
  focusedIndex = signal(-1);

  selectedCount = computed(() => this.selected().length);

  toggle(): void {
    this.isOpen.update((v) => !v);
    if (!this.isOpen()) {
      this.focusedIndex.set(-1);
    }
  }

  close(): void {
    this.isOpen.set(false);
    this.focusedIndex.set(-1);
  }

  isSelected(id: string): boolean {
    return this.selected().includes(id);
  }

  toggleOption(id: string): void {
    const current = this.selected();
    const updated = this.isSelected(id)
      ? current.filter((s) => s !== id)
      : [...current, id];
    this.selectionChange.emit(updated);
  }

  selectAll(): void {
    const allIds = this.options().map((o) => o.id);
    this.selectionChange.emit(allIds);
  }

  clearAll(): void {
    this.selectionChange.emit([]);
  }

  onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!this.isOpen()) {
        this.isOpen.set(true);
      }
      this.focusedIndex.set(0);
    } else if (event.key === 'Escape') {
      this.close();
    }
  }

  onListKeydown(event: KeyboardEvent): void {
    const opts = this.options();
    const idx = this.focusedIndex();

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.focusedIndex.set(Math.min(idx + 1, opts.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.focusedIndex.set(Math.max(idx - 1, 0));
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (idx >= 0 && idx < opts.length) {
          this.toggleOption(opts[idx].id);
        }
        break;
      case 'Escape':
        event.preventDefault();
        this.close();
        break;
      case 'Home':
        event.preventDefault();
        this.focusedIndex.set(0);
        break;
      case 'End':
        event.preventDefault();
        this.focusedIndex.set(opts.length - 1);
        break;
    }
  }
}
