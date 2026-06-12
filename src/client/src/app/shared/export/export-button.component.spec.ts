import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { ExportButtonComponent, type ExportAction } from './export-button.component';

/**
 * Constructs the component class in an injection context (so its `input()` /
 * `signal()` / `computed()` members initialize) without compiling the template.
 * The repo's unit runner is node-only (vitest.units.config.ts) and has no
 * Angular component-compilation plugin, so we exercise the component's logic
 * (runAction -> loading/error) directly rather than via TestBed rendering.
 * Mirrors the service-spec pattern (e.g. catalyst.service.spec.ts).
 */
function makeComponent(): ExportButtonComponent {
  const injector = Injector.create({ providers: [] });
  return runInInjectionContext(injector, () => new ExportButtonComponent());
}

describe('ExportButtonComponent', () => {
  it('runs the single action and toggles loading', async () => {
    let resolve!: () => void;
    const action: ExportAction = {
      label: 'Excel',
      format: 'xlsx',
      run: () => new Promise<void>((r) => (resolve = r)),
    };
    const cmp = makeComponent();

    const p = cmp.runAction(action);
    expect(cmp.loading()).toBe(true);
    resolve();
    await p;
    expect(cmp.loading()).toBe(false);
    expect(cmp.error()).toBeNull();
  });

  it('surfaces an inline error when an action rejects', async () => {
    const action: ExportAction = {
      label: 'Excel',
      format: 'xlsx',
      run: () => Promise.reject(new Error('boom')),
    };
    const cmp = makeComponent();

    await cmp.runAction(action);
    expect(cmp.loading()).toBe(false);
    expect(cmp.error()).toBe('Export failed. Please try again.');
  });

  it('ignores a second run while one is in flight', async () => {
    let resolve!: () => void;
    let calls = 0;
    const action: ExportAction = {
      label: 'Excel',
      format: 'xlsx',
      run: () => {
        calls++;
        return new Promise<void>((r) => (resolve = r));
      },
    };
    const cmp = makeComponent();

    const p = cmp.runAction(action);
    await cmp.runAction(action); // re-entrant call is a no-op while loading
    expect(calls).toBe(1);
    resolve();
    await p;
    expect(cmp.loading()).toBe(false);
  });
});
