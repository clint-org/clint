/**
 * Default significance is a NOT NULL column on `event_types`
 * (`default_significance text not null default 'high' check (... in
 * ('high','low'))`, migration 20260628071012_event_types.sql). The form must
 * therefore never offer a null/"None" choice: doing so produced a raw 23502
 * not-null violation on create (QA-011). These options and the default are kept
 * here, in lockstep with the DB constraint, so a regression test can guard the
 * invariant without standing up the whole component.
 */
export type EventTypeSignificance = 'high' | 'low';

export const EVENT_TYPE_SIGNIFICANCE_OPTIONS: {
  label: string;
  value: EventTypeSignificance;
}[] = [
  { label: 'High', value: 'high' },
  { label: 'Low', value: 'low' },
];

/** Matches the column default; new custom types start as high-significance. */
export const DEFAULT_EVENT_TYPE_SIGNIFICANCE: EventTypeSignificance = 'high';
