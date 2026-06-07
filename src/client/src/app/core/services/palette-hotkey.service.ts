import { Injectable, signal } from '@angular/core';

export function shouldOpenPalette(ev: KeyboardEvent): boolean {
  const key = (ev.key ?? '').toLowerCase();
  const isCmdK = key === 'k' && (ev.metaKey || ev.ctrlKey);
  if (isCmdK) return true;

  if (key === '/') {
    const target = ev.target as { tagName?: string; isContentEditable?: boolean } | null;
    const tag = (target?.tagName ?? '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return false;
    return true;
  }
  return false;
}

@Injectable({ providedIn: 'root' })
export class PaletteHotkeyService {
  readonly isOpen = signal(false);

  constructor() {
    // Zoneless: writing the `isOpen` signal in the handler triggers change
    // detection directly, so no NgZone.run / runOutsideAngular wrapper is needed.
    document.addEventListener('keydown', this.onKeydown, { capture: false });
  }

  private readonly onKeydown = (ev: KeyboardEvent) => {
    if (this.isOpen() && ev.key === 'Escape') {
      this.isOpen.set(false);
      ev.preventDefault();
      return;
    }
    if (shouldOpenPalette(ev)) {
      this.isOpen.set(true);
      ev.preventDefault();
    }
  };

  open() { this.isOpen.set(true); }
  close() { this.isOpen.set(false); }
  toggle() { this.isOpen.update((v) => !v); }
}
