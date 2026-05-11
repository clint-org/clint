import { describe, expect, it } from 'vitest';
import { computeBrief, BriefInput } from './brief-window';

const ANCHOR = new Date('2026-05-11T00:00:00Z'); // Mon May 11
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (n: number) => {
  const d = new Date(ANCHOR);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

const c = (
  marker_id: string,
  event_date: string,
  title = 'Catalyst',
  company_name: string | null = null
): BriefInput => ({ marker_id, event_date, title, company_name });

describe('computeBrief', () => {
  it('returns null when the input list is empty', () => {
    expect(computeBrief([], ANCHOR)).toBeNull();
  });

  it('returns null when nothing falls within 90 days', () => {
    const list = [c('m1', plusDays(91))];
    expect(computeBrief(list, ANCHOR)).toBeNull();
  });

  it('returns THIS WEEK when the nearest event is today', () => {
    const list = [c('m1', plusDays(0), 'REDEFINE-2 topline', 'Novo Nordisk')];
    const result = computeBrief(list, ANCHOR);
    expect(result).toEqual({
      window: 'THIS WEEK',
      lead: list[0],
      additional: 0,
    });
  });

  it('returns THIS WEEK on day 7 (inclusive boundary)', () => {
    const list = [c('m1', plusDays(7))];
    expect(computeBrief(list, ANCHOR)?.window).toBe('THIS WEEK');
  });

  it('returns THIS MONTH on day 8 (just past the week boundary)', () => {
    const list = [c('m1', plusDays(8))];
    expect(computeBrief(list, ANCHOR)?.window).toBe('THIS MONTH');
  });

  it('returns THIS MONTH on day 30 (inclusive boundary)', () => {
    const list = [c('m1', plusDays(30))];
    expect(computeBrief(list, ANCHOR)?.window).toBe('THIS MONTH');
  });

  it('returns NEXT QUARTER on day 31', () => {
    const list = [c('m1', plusDays(31))];
    expect(computeBrief(list, ANCHOR)?.window).toBe('NEXT QUARTER');
  });

  it('returns NEXT QUARTER on day 90 (inclusive boundary)', () => {
    const list = [c('m1', plusDays(90))];
    expect(computeBrief(list, ANCHOR)?.window).toBe('NEXT QUARTER');
  });

  it('counts additional catalysts in the same window', () => {
    const list = [c('m1', plusDays(2)), c('m2', plusDays(4)), c('m3', plusDays(6))];
    const result = computeBrief(list, ANCHOR);
    expect(result?.window).toBe('THIS WEEK');
    expect(result?.additional).toBe(2);
  });

  it('only counts additional catalysts that share the chosen window', () => {
    // First catalyst is in week; second is past the 7d window.
    const list = [c('m1', plusDays(3)), c('m2', plusDays(20))];
    const result = computeBrief(list, ANCHOR);
    expect(result?.window).toBe('THIS WEEK');
    expect(result?.additional).toBe(0);
  });

  it('skips events that already passed (date earlier than anchor)', () => {
    const list = [c('m_past', plusDays(-1)), c('m_future', plusDays(5))];
    const result = computeBrief(list, ANCHOR);
    expect(result?.lead.marker_id).toBe('m_future');
    expect(result?.additional).toBe(0);
  });
});
