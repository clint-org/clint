import { signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import type { ExportAction } from './export-button.component';
import { createTopbarExportSync } from './topbar-export-sync';

const action = (label: string): ExportAction => ({
  label,
  format: 'xlsx',
  run: () => Promise.resolve(),
});

describe('createTopbarExportSync', () => {
  it('publishes actions and clears them on teardown', () => {
    const exportActions = signal<ExportAction[]>([]);
    const sync = createTopbarExportSync({ exportActions });
    const mine = [action('Excel (XLSX)')];
    sync.push(mine);
    expect(exportActions()).toBe(mine);
    sync.teardown();
    expect(exportActions()).toEqual([]);
  });

  it('does not clear actions another page has already published', () => {
    const exportActions = signal<ExportAction[]>([]);
    const outgoing = createTopbarExportSync({ exportActions });
    outgoing.push([action('Excel (XLSX)')]);

    const incoming = createTopbarExportSync({ exportActions });
    const newActions = [action('Image (PNG)')];
    incoming.push(newActions);

    outgoing.teardown();
    expect(exportActions()).toBe(newActions);
  });

  it('is a no-op before the first push', () => {
    const exportActions = signal<ExportAction[]>([]);
    const other = [action('Image (PNG)')];
    exportActions.set(other);
    createTopbarExportSync({ exportActions }).teardown();
    expect(exportActions()).toBe(other);
  });
});
