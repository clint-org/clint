import { signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import {
  createTaxonomyController,
  TAXONOMY_NAME_MAXLEN,
  type CreateFn,
} from './taxonomy-create-controller';
import type { TaxonomyOption } from './taxonomy-match';

function opt(id: string, name: string): TaxonomyOption {
  return { id, name };
}

/** A createFn whose resolution the test controls. */
function deferredCreate() {
  let resolve!: (o: TaxonomyOption) => void;
  let reject!: (e: unknown) => void;
  let calls = 0;
  const promise = new Promise<TaxonomyOption>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const fn: CreateFn = () => {
    calls++;
    return promise;
  };
  return { fn, resolve, reject, calls: () => calls };
}

function setup(over: {
  options?: TaxonomyOption[];
  value?: string[];
  createFn?: CreateFn | null;
}) {
  const options = signal<TaxonomyOption[]>(over.options ?? []);
  const value = signal<string[]>(over.value ?? []);
  const createFn = signal<CreateFn | null>(over.createFn ?? null);
  const controller = createTaxonomyController({ options, value, createFn });
  return { controller, options, value, createFn };
}

describe('footer state', () => {
  it('is hidden when the filter is empty', () => {
    const { controller } = setup({ createFn: async () => opt('x', 'x') });
    controller.setFilter('');
    expect(controller.footer().showCreate).toBe(false);
    expect(controller.footer().near).toEqual([]);
  });

  it('is hidden (no create) for a whitespace-only filter', () => {
    const { controller } = setup({ createFn: async () => opt('x', 'x') });
    controller.setFilter('   ');
    expect(controller.footer().showCreate).toBe(false);
  });

  it('hides the create affordance entirely when no createFn is provided', () => {
    const { controller } = setup({
      createFn: null,
      options: [opt('1', 'GLP-1 receptor agonist')],
    });
    controller.setFilter('SGLT2 inhibitor');
    expect(controller.footer().showCreate).toBe(false);
    expect(controller.footer().near).toEqual([]);
  });

  it('offers create with the trimmed label for a novel value', () => {
    const { controller } = setup({ createFn: async () => opt('x', 'x') });
    controller.setFilter('  SGLT2 inhibitor  ');
    expect(controller.footer().showCreate).toBe(true);
    expect(controller.footer().createLabel).toBe('SGLT2 inhibitor');
  });

  it('suppresses create when the value already exists exactly', () => {
    const { controller } = setup({
      createFn: async () => opt('x', 'x'),
      options: [opt('1', 'GLP-1 receptor agonist')],
    });
    controller.setFilter('glp-1 receptor agonist');
    expect(controller.footer().showCreate).toBe(false);
    expect(controller.footer().near).toEqual([]);
  });

  it('shows a near suggestion alongside the create row', () => {
    const { controller } = setup({
      createFn: async () => opt('x', 'x'),
      options: [opt('1', 'GLP-1 receptor agonist')],
    });
    controller.setFilter('GLP-1');
    expect(controller.footer().near.map((o) => o.name)).toEqual(['GLP-1 receptor agonist']);
    expect(controller.footer().showCreate).toBe(true);
  });
});

describe('create', () => {
  it('appends the created id, preserves existing selections, clears the filter', async () => {
    const { fn, resolve } = deferredCreate();
    const { controller, value } = setup({ createFn: fn, value: ['existing'] });
    controller.setFilter('SGLT2 inhibitor');

    const pending = controller.create();
    resolve(opt('new-id', 'SGLT2 inhibitor'));
    await pending;

    expect(value()).toEqual(['existing', 'new-id']);
    expect(controller.footer().showCreate).toBe(false); // filter cleared
  });

  it('resolves true on success and false on failure or no-op', async () => {
    const ok: CreateFn = async (name) => opt('new-id', name);
    const okCtl = setup({ createFn: ok });
    okCtl.controller.setFilter('SGLT2 inhibitor');
    expect(await okCtl.controller.create()).toBe(true);

    const bad: CreateFn = async () => {
      throw new Error('duplicate key');
    };
    const badCtl = setup({ createFn: bad });
    badCtl.controller.setFilter('SGLT2 inhibitor');
    expect(await badCtl.controller.create()).toBe(false);

    const noneCtl = setup({ createFn: null });
    noneCtl.controller.setFilter('SGLT2 inhibitor');
    expect(await noneCtl.controller.create()).toBe(false);
  });

  it('passes the trimmed text to createFn', async () => {
    let received = '';
    const fn: CreateFn = async (name) => {
      received = name;
      return opt('new-id', name);
    };
    const { controller } = setup({ createFn: fn });
    controller.setFilter('  SGLT2 inhibitor  ');
    await controller.create();
    expect(received).toBe('SGLT2 inhibitor');
  });

  it('truncates an over-length name to the column maximum', async () => {
    let received = '';
    const fn: CreateFn = async (name) => {
      received = name;
      return opt('new-id', name);
    };
    const { controller } = setup({ createFn: fn });
    controller.setFilter('x'.repeat(TAXONOMY_NAME_MAXLEN + 50));
    await controller.create();
    expect(received).toHaveLength(TAXONOMY_NAME_MAXLEN);
  });

  it('guards against a double-submit while a create is in flight', async () => {
    const { fn, resolve, calls } = deferredCreate();
    const { controller } = setup({ createFn: fn });
    controller.setFilter('SGLT2 inhibitor');

    const first = controller.create();
    void controller.create(); // second click while pending
    expect(calls()).toBe(1);
    expect(controller.creating()).toBe(true);

    resolve(opt('new-id', 'SGLT2 inhibitor'));
    await first;
    expect(controller.creating()).toBe(false);
  });

  it('recovers from a failed create without mutating selection or filter', async () => {
    const { fn, reject } = deferredCreate();
    const { controller, value } = setup({ createFn: fn, value: ['existing'] });
    controller.setFilter('SGLT2 inhibitor');

    const pending = controller.create();
    reject(new Error('duplicate key'));
    await pending;

    expect(value()).toEqual(['existing']); // untouched
    expect(controller.creating()).toBe(false);
    expect(controller.footer().createLabel).toBe('SGLT2 inhibitor'); // filter kept
  });

  it('does nothing when there is no createFn', async () => {
    const { controller, value } = setup({ createFn: null });
    controller.setFilter('SGLT2 inhibitor');
    await controller.create();
    expect(value()).toEqual([]);
  });
});

describe('selectExisting', () => {
  it('adds the existing option and clears the filter without creating', () => {
    const { controller, value } = setup({
      createFn: async () => opt('x', 'x'),
      options: [opt('1', 'GLP-1 receptor agonist')],
    });
    controller.setFilter('GLP-1');
    controller.selectExisting(opt('1', 'GLP-1 receptor agonist'));
    expect(value()).toEqual(['1']);
    expect(controller.footer().showCreate).toBe(false);
  });

  it('does not duplicate an already-selected option', () => {
    const { controller, value } = setup({
      createFn: async () => opt('x', 'x'),
      value: ['1'],
      options: [opt('1', 'GLP-1 receptor agonist')],
    });
    controller.selectExisting(opt('1', 'GLP-1 receptor agonist'));
    expect(value()).toEqual(['1']);
  });
});
