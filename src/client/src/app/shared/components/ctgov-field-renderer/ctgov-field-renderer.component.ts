import { Component, computed, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { CTGOV_FIELD_CATALOGUE, CtgovField } from '../../../core/models/ctgov-field.model';

interface RenderedField {
  field: CtgovField;
  value: unknown;
}

@Component({
  selector: 'app-ctgov-field-renderer',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './ctgov-field-renderer.component.html',
})
export class CtgovFieldRendererComponent {
  readonly snapshot = input.required<unknown>();
  readonly paths = input.required<string[]>();
  readonly dense = input<boolean>(false);

  // expanded array fields for "show all items" toggle
  readonly expanded = signal<Set<string>>(new Set());

  readonly renderedFields = computed<RenderedField[]>(() => {
    const snap = this.snapshot() as Record<string, unknown> | null;
    return this.paths()
      .map((path) => {
        const field = lookupField(path);
        if (!field) return null;
        const value = walkPath(snap, path);
        return { field, value };
      })
      .filter((r): r is RenderedField => r !== null);
  });

  toggleExpanded(path: string): void {
    this.expanded.update((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  isExpanded(path: string): boolean {
    return this.expanded().has(path);
  }

  // Helpers exposed to template for type-narrowing convenience.
  asArray(value: unknown): unknown[] | null {
    return Array.isArray(value) ? value : null;
  }

  itemValue(item: unknown, itemPath: string | undefined): string {
    if (!itemPath) return String(item);
    if (typeof item === 'object' && item !== null) {
      return String((item as Record<string, unknown>)[itemPath] ?? '');
    }
    return String(item);
  }
}

function lookupField(path: string): CtgovField | undefined {
  return CTGOV_FIELD_CATALOGUE.find((f) => f.path === path);
}

function walkPath(snap: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = snap;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}
