import { computed, signal, type Signal, type WritableSignal } from '@angular/core';
import { classify, type TaxonomyOption } from './taxonomy-match';

/** Creates a taxonomy value by name and resolves to the persisted row. */
export type CreateFn = (name: string) => Promise<TaxonomyOption>;

/**
 * Tightest target column among the supported taxonomies
 * (`indications.name varchar(255)`). The filter input is capped to this and the
 * created name is truncated to match, so an over-length paste can never fail at
 * the database.
 */
export const TAXONOMY_NAME_MAXLEN = 255;

export interface FooterState {
  /** Closest existing options to suggest instead of creating. */
  near: TaxonomyOption[];
  /** Whether to offer a "Create '<label>'" row. */
  showCreate: boolean;
  /** Trimmed text that would be created. */
  createLabel: string;
}

export interface TaxonomyController {
  readonly creating: Signal<boolean>;
  readonly footer: Signal<FooterState>;
  setFilter(text: string): void;
  selectExisting(option: TaxonomyOption): void;
  /** Resolves true when a new value was created, false on no-op or failure. */
  create(): Promise<boolean>;
}

export interface TaxonomyControllerDeps {
  options: Signal<TaxonomyOption[]>;
  value: WritableSignal<string[]>;
  /**
   * Persists a new value and resolves to the saved row. The host is expected to
   * also register the row in its `options` signal so the multiselect can render
   * it as selected; null disables creation entirely.
   */
  createFn: Signal<CreateFn | null>;
}

const HIDDEN: FooterState = { near: [], showCreate: false, createLabel: '' };

export function createTaxonomyController(deps: TaxonomyControllerDeps): TaxonomyController {
  const filterText = signal('');
  const creating = signal(false);

  const footer = computed<FooterState>(() => {
    if (!deps.createFn()) return HIDDEN;
    const label = filterText().trim();
    if (label.length === 0) return HIDDEN;

    const match = classify(label, deps.options());
    if (match.kind === 'exact') return HIDDEN;
    return { near: match.near, showCreate: true, createLabel: label };
  });

  function addId(id: string): void {
    deps.value.update((ids) => (ids.includes(id) ? ids : [...ids, id]));
  }

  function selectExisting(option: TaxonomyOption): void {
    addId(option.id);
    filterText.set('');
  }

  async function create(): Promise<boolean> {
    if (creating()) return false;
    const fn = deps.createFn();
    if (!fn) return false;
    const name = filterText().trim().slice(0, TAXONOMY_NAME_MAXLEN);
    if (name.length === 0) return false;

    creating.set(true);
    try {
      const option = await fn(name);
      addId(option.id);
      filterText.set('');
      return true;
    } catch {
      // The originating service surfaces the error toast (per client
      // guardrails). Keep the filter so the user can retry or pick the
      // now-existing value; leave selection untouched.
      return false;
    } finally {
      creating.set(false);
    }
  }

  return {
    creating: creating.asReadonly(),
    footer,
    setFilter: (text: string) => filterText.set(text),
    selectExisting,
    create,
  };
}
