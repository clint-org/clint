/**
 * Unit tests for confirm-delete: the pure helpers (count formatting,
 * key humanization, typed-confirmation resolution) plus the helper
 * function's routing (legacy ConfirmationService path vs. count-aware
 * opener path).
 *
 * The full ConfirmDeleteDialogComponent is exercised in the e2e specs
 * because PrimeNG's Dialog needs a real DOM. Here we verify the pure
 * logic the component reuses, plus the contract the helper makes when
 * deciding which dialog to open.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmationService } from 'primeng/api';

import {
  _getRegisteredConfirmDeleteOpener,
  _registerConfirmDeleteOpener,
  confirmDelete,
  formatCountBreakdown,
  humanizeCountKey,
  resolveTypedConfirmationValue,
  type ConfirmDeleteOptions,
  type DeleteCountBreakdown,
} from './confirm-delete';

afterEach(() => {
  _registerConfirmDeleteOpener(null);
});

describe('humanizeCountKey', () => {
  it('returns the marker_assignments key as "Marker assignments"', () => {
    expect(humanizeCountKey('marker_assignments')).toBe('Marker assignments');
  });

  it('renders markers_removed_entirely with the explicit label', () => {
    expect(humanizeCountKey('markers_removed_entirely')).toBe('Markers removed entirely');
  });

  it('renders markers_unlinked_only with the explicit label', () => {
    expect(humanizeCountKey('markers_unlinked_only')).toBe('Markers unlinked only');
  });

  it('renders primary_intelligence as "Intelligence reads"', () => {
    expect(humanizeCountKey('primary_intelligence')).toBe('Intelligence reads');
  });

  it('renders primary_intelligence_links as "Intelligence links"', () => {
    expect(humanizeCountKey('primary_intelligence_links')).toBe('Intelligence links');
  });

  it('renders the products count key as "Assets" (user-facing noun)', () => {
    expect(humanizeCountKey('products')).toBe('Assets');
  });

  it('sentence-cases generic keys', () => {
    expect(humanizeCountKey('trials')).toBe('Trials');
    expect(humanizeCountKey('events')).toBe('Events');
  });

  it('replaces underscores with spaces in unknown keys', () => {
    expect(humanizeCountKey('foo_bar_baz')).toBe('Foo bar baz');
  });

  it('returns the original key when blank after stripping', () => {
    expect(humanizeCountKey('')).toBe('');
  });
});

describe('formatCountBreakdown', () => {
  it('returns an empty array for an empty object', () => {
    expect(formatCountBreakdown({})).toEqual([]);
  });

  it('renders every positive count', () => {
    const counts: DeleteCountBreakdown = {
      products: 14,
      trials: 47,
      events: 312,
    };
    const rows = formatCountBreakdown(counts);
    expect(rows).toEqual([
      { key: 'products', label: 'Assets', value: 14 },
      { key: 'trials', label: 'Trials', value: 47 },
      { key: 'events', label: 'Events', value: 312 },
    ]);
  });

  it('suppresses zero counts', () => {
    const counts: DeleteCountBreakdown = {
      products: 5,
      trials: 0,
      events: 2,
    };
    const rows = formatCountBreakdown(counts);
    expect(rows.map((r) => r.key)).toEqual(['products', 'events']);
  });

  it('suppresses negative counts', () => {
    const counts: DeleteCountBreakdown = {
      products: -1,
      trials: 4,
    };
    const rows = formatCountBreakdown(counts);
    expect(rows.map((r) => r.key)).toEqual(['trials']);
  });

  it('renders both marker keys when both are positive', () => {
    const counts: DeleteCountBreakdown = {
      markers_removed_entirely: 123,
      markers_unlinked_only: 1724,
    };
    const rows = formatCountBreakdown(counts);
    expect(rows).toEqual([
      { key: 'markers_removed_entirely', label: 'Markers removed entirely', value: 123 },
      { key: 'markers_unlinked_only', label: 'Markers unlinked only', value: 1724 },
    ]);
  });

  it('preserves insertion order from the source jsonb', () => {
    const counts: DeleteCountBreakdown = {
      events: 312,
      products: 14,
      trials: 47,
    };
    const rows = formatCountBreakdown(counts);
    expect(rows.map((r) => r.key)).toEqual(['events', 'products', 'trials']);
  });
});

describe('resolveTypedConfirmationValue', () => {
  it('returns null when nothing is set', () => {
    expect(resolveTypedConfirmationValue({ header: 'Delete' })).toBeNull();
  });

  it('returns the explicit typedConfirmationValue when set', () => {
    expect(
      resolveTypedConfirmationValue({
        header: 'Delete',
        entityLabel: 'Eli Lilly',
        typedConfirmationValue: 'Eli Lilly',
      }),
    ).toBe('Eli Lilly');
  });

  it('defaults to entityLabel when no explicit typedConfirmationValue is set', () => {
    expect(
      resolveTypedConfirmationValue({ header: 'Delete', entityLabel: 'Eli Lilly' }),
    ).toBe('Eli Lilly');
  });

  it('returns "delete" for the unnamed path when requireTypedConfirmation is true', () => {
    expect(
      resolveTypedConfirmationValue({ header: 'Delete', requireTypedConfirmation: true }),
    ).toBe('delete');
  });

  it('honors an explicit typedConfirmationValue of "delete" for the unnamed path', () => {
    expect(
      resolveTypedConfirmationValue({ header: 'Delete', typedConfirmationValue: 'delete' }),
    ).toBe('delete');
  });

  it('short-circuits to null when requireTypedConfirmation is explicitly false', () => {
    expect(
      resolveTypedConfirmationValue({
        header: 'Delete',
        entityLabel: 'Eli Lilly',
        requireTypedConfirmation: false,
      }),
    ).toBeNull();
  });

  it('returns null when entityLabel is an empty string', () => {
    expect(resolveTypedConfirmationValue({ header: 'Delete', entityLabel: '' })).toBeNull();
  });
});

/**
 * Build a mock ConfirmationService whose `confirm()` captures the
 * passed-in config so the test can inspect what the dialog would have
 * rendered, then invoke accept or reject on demand.
 */
function makeConfirmationMock(): {
  service: ConfirmationService;
  lastConfirm: () => Parameters<ConfirmationService['confirm']>[0] | null;
  accept: () => void;
  reject: () => void;
} {
  let captured: Parameters<ConfirmationService['confirm']>[0] | null = null;
  const confirm = vi.fn((config: Parameters<ConfirmationService['confirm']>[0]) => {
    captured = config;
    return service;
  });
  const service = { confirm } as unknown as ConfirmationService;
  return {
    service,
    lastConfirm: () => captured,
    accept: () => {
      const fn = captured?.accept;
      if (typeof fn === 'function') (fn as () => void)();
    },
    reject: () => {
      const fn = captured?.reject;
      if (typeof fn === 'function') (fn as () => void)();
    },
  };
}

describe('confirmDelete (legacy plain-confirm path)', () => {
  it('forwards header and message to ConfirmationService.confirm', () => {
    const mock = makeConfirmationMock();
    void confirmDelete(mock.service, { header: 'Delete company', message: 'Delete "Eli Lilly"?' });
    const config = mock.lastConfirm();
    expect(config?.header).toBe('Delete company');
    expect(config?.message).toBe('Delete "Eli Lilly"?');
    expect(config?.acceptLabel).toBe('Delete');
    expect(config?.rejectLabel).toBe('Cancel');
  });

  it('appends details to message when both are set', () => {
    const mock = makeConfirmationMock();
    void confirmDelete(mock.service, {
      header: 'Delete company',
      message: 'Delete "Eli Lilly"?',
      details: 'This cannot be undone.',
    });
    expect(mock.lastConfirm()?.message).toBe('Delete "Eli Lilly"? This cannot be undone.');
  });

  it('resolves true when the user accepts', async () => {
    const mock = makeConfirmationMock();
    const promise = confirmDelete(mock.service, { header: 'Delete', message: 'OK?' });
    mock.accept();
    await expect(promise).resolves.toBe(true);
  });

  it('resolves false when the user cancels', async () => {
    const mock = makeConfirmationMock();
    const promise = confirmDelete(mock.service, { header: 'Delete', message: 'OK?' });
    mock.reject();
    await expect(promise).resolves.toBe(false);
  });

  it('uses the legacy path when only header is set (no counts, no typed gate)', () => {
    const mock = makeConfirmationMock();
    void confirmDelete(mock.service, { header: 'Delete' });
    expect(mock.lastConfirm()).not.toBeNull();
  });

  it('uses the legacy path even with a custom acceptLabel as long as no counts or typed gate', () => {
    const mock = makeConfirmationMock();
    void confirmDelete(mock.service, {
      header: 'Remove member',
      message: 'Remove member?',
      acceptLabel: 'Remove',
    });
    expect(mock.lastConfirm()?.acceptLabel).toBe('Remove');
  });
});

describe('confirmDelete (count-aware opener path)', () => {
  it('routes through the registered opener when counts are present', async () => {
    const mock = makeConfirmationMock();
    const opener = vi.fn(async () => true);
    _registerConfirmDeleteOpener(opener);
    expect(_getRegisteredConfirmDeleteOpener()).toBe(opener);

    const opts: ConfirmDeleteOptions = {
      header: 'Delete company',
      entityLabel: 'Eli Lilly',
      counts: { products: 14, trials: 47, events: 312 },
      typedConfirmationValue: 'Eli Lilly',
    };
    const result = await confirmDelete(mock.service, opts);

    expect(result).toBe(true);
    expect(opener).toHaveBeenCalledTimes(1);
    expect(opener).toHaveBeenCalledWith(opts);
    // Legacy confirm() must not have been called when the opener took over.
    expect((mock.service.confirm as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('routes through the opener when only requireTypedConfirmation is true', async () => {
    const mock = makeConfirmationMock();
    const opener = vi.fn(async () => true);
    _registerConfirmDeleteOpener(opener);

    await confirmDelete(mock.service, {
      header: 'Delete marker',
      requireTypedConfirmation: true,
      // No entityLabel, no typedConfirmationValue: this is the "unnamed
      // item, type the literal 'delete'" path.
    });

    expect(opener).toHaveBeenCalledTimes(1);
    const passed = opener.mock.calls[0][0];
    expect(resolveTypedConfirmationValue(passed)).toBe('delete');
  });

  it('routes through the opener when typedConfirmationValue is "delete" for unnamed items', async () => {
    const mock = makeConfirmationMock();
    const opener = vi.fn(async () => true);
    _registerConfirmDeleteOpener(opener);

    const opts: ConfirmDeleteOptions = {
      header: 'Delete event',
      typedConfirmationValue: 'delete',
    };
    await confirmDelete(mock.service, opts);

    expect(opener).toHaveBeenCalledWith(opts);
  });

  it('falls back to the legacy path if no opener is registered', () => {
    const mock = makeConfirmationMock();
    // Opener intentionally null: simulate the dialog component not yet
    // mounted (e.g. mid-bootstrap or during a test harness).
    void confirmDelete(mock.service, {
      header: 'Delete',
      counts: { products: 3 },
    });
    expect(mock.lastConfirm()).not.toBeNull();
  });

  it('resolves false when the opener resolves false (cancel path)', async () => {
    const mock = makeConfirmationMock();
    _registerConfirmDeleteOpener(async () => false);
    const result = await confirmDelete(mock.service, {
      header: 'Delete',
      counts: { products: 3 },
      typedConfirmationValue: 'Foo',
    });
    expect(result).toBe(false);
  });
});

describe('typed-confirmation gating behavior', () => {
  /**
   * The dialog component itself reuses `resolveTypedConfirmationValue`
   * and an exact-equality check on the typed input. These tests assert
   * the predicate-level contract end-to-end without instantiating the
   * Angular component (whose template needs a DOM).
   */
  it('keeps the gate active when the typed string mismatches', () => {
    const required = resolveTypedConfirmationValue({
      header: 'Delete company',
      entityLabel: 'Eli Lilly',
    });
    expect(required).toBe('Eli Lilly');
    expect('Eli L' === required).toBe(false);
    expect('eli lilly' === required).toBe(false); // case-sensitive by design
  });

  it('opens the gate only on an exact match', () => {
    const required = resolveTypedConfirmationValue({
      header: 'Delete company',
      entityLabel: 'Eli Lilly',
    });
    expect('Eli Lilly' === required).toBe(true);
  });

  it('for unnamed items, requires the literal string "delete"', () => {
    const required = resolveTypedConfirmationValue({
      header: 'Delete marker',
      typedConfirmationValue: 'delete',
    });
    expect(required).toBe('delete');
    expect('delete' === required).toBe(true);
    expect('Delete' === required).toBe(false);
  });
});
