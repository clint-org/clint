import { describe, expect, it } from 'vitest';
import { computeStatusStrip } from './ai-status';

describe('computeStatusStrip', () => {
  const healthOperational = {
    status: 'operational',
    description: 'All Systems Operational',
    indicator: 'none',
    incidents: [],
    checked_at: '2026-05-27T00:00:00Z',
  };

  const quotaAllClear = {
    ai_enabled: true,
    daily_cap_cents: 1000,
    spent_today_cents: 200,
    rate_used_hour: 2,
    rate_limit_hour: 10,
  };

  it('returns null when all systems are clear', () => {
    const result = computeStatusStrip(healthOperational, quotaAllClear);
    expect(result).toBeNull();
  });

  it('priority 1: returns block on major outage', () => {
    const health = { ...healthOperational, status: 'major_outage' };
    const result = computeStatusStrip(health, quotaAllClear);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('block');
    expect(result!.message).toContain('outage');
  });

  it('does NOT surface partial outage (non-actionable upstream status)', () => {
    const health = { ...healthOperational, status: 'partial_outage' };
    const result = computeStatusStrip(health, quotaAllClear);
    expect(result).toBeNull();
  });

  it('does NOT surface degraded performance (non-actionable upstream status)', () => {
    const health = { ...healthOperational, status: 'degraded_performance' };
    const result = computeStatusStrip(health, quotaAllClear);
    expect(result).toBeNull();
  });

  it('priority 4: returns block when AI is disabled', () => {
    const quota = { ...quotaAllClear, ai_enabled: false };
    const result = computeStatusStrip(healthOperational, quota);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('block');
    expect(result!.message).toContain('not enabled');
  });

  it('priority 5: returns block when daily quota is exhausted', () => {
    const quota = { ...quotaAllClear, daily_cap_cents: 1000, spent_today_cents: 1000 };
    const result = computeStatusStrip(healthOperational, quota);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('block');
    expect(result!.message).toContain('Daily AI usage limit reached');
    expect(result!.message).toContain('1000/1000');
  });

  it('priority 5: returns block when spent exceeds cap', () => {
    const quota = { ...quotaAllClear, daily_cap_cents: 500, spent_today_cents: 600 };
    const result = computeStatusStrip(healthOperational, quota);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('block');
    expect(result!.message).toContain('Daily AI usage limit reached');
  });

  it('priority 6: returns block when hourly rate limit is reached', () => {
    const quota = { ...quotaAllClear, rate_used_hour: 10, rate_limit_hour: 10 };
    const result = computeStatusStrip(healthOperational, quota);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('block');
    expect(result!.message).toContain('Hourly rate limit reached');
    expect(result!.message).toContain('10/10');
  });

  it('priority 7: returns warn when at 80%+ of daily cap', () => {
    const quota = { ...quotaAllClear, daily_cap_cents: 1000, spent_today_cents: 850 };
    const result = computeStatusStrip(healthOperational, quota);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('warn');
    expect(result!.message).toContain('85%');
    expect(result!.message).toContain('150 cents remaining');
  });

  it('priority 7: returns warn at exactly 80%', () => {
    const quota = { ...quotaAllClear, daily_cap_cents: 1000, spent_today_cents: 800 };
    const result = computeStatusStrip(healthOperational, quota);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('warn');
    expect(result!.message).toContain('80%');
  });

  it('does NOT surface upstream incidents to users (non-actionable)', () => {
    // Upstream status-page incidents lingered for days and users can't act on
    // them; only the user's own quota/rate state and hard outages are shown.
    const health = {
      ...healthOperational,
      incidents: [{ name: 'Elevated error rates', status: 'investigating', impact: 'minor' }],
    };
    const result = computeStatusStrip(health, quotaAllClear);
    expect(result).toBeNull();
  });

  it('still surfaces a major outage even with incidents present', () => {
    const health = {
      ...healthOperational,
      status: 'major_outage',
      incidents: [{ name: 'Elevated error rates', status: 'investigating', impact: 'minor' }],
    };
    const result = computeStatusStrip(health, quotaAllClear);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('block');
  });

  it('major outage takes priority over AI disabled', () => {
    const health = { ...healthOperational, status: 'major_outage' };
    const quota = { ...quotaAllClear, ai_enabled: false };
    const result = computeStatusStrip(health, quota);
    expect(result!.level).toBe('block');
    expect(result!.message).toContain('outage');
  });

  it('AI disabled takes priority over quota exhausted', () => {
    const quota = {
      ...quotaAllClear,
      ai_enabled: false,
      daily_cap_cents: 100,
      spent_today_cents: 200,
    };
    const result = computeStatusStrip(healthOperational, quota);
    expect(result!.level).toBe('block');
    expect(result!.message).toContain('not enabled');
  });

  it('quota exhausted takes priority over rate limit', () => {
    const quota = {
      ...quotaAllClear,
      daily_cap_cents: 500,
      spent_today_cents: 500,
      rate_used_hour: 10,
      rate_limit_hour: 10,
    };
    const result = computeStatusStrip(healthOperational, quota);
    expect(result!.level).toBe('block');
    expect(result!.message).toContain('Daily AI usage limit');
  });

  it('rate limit takes priority over near-limit warning', () => {
    const quota = {
      ...quotaAllClear,
      daily_cap_cents: 1000,
      spent_today_cents: 850,
      rate_used_hour: 10,
      rate_limit_hour: 10,
    };
    const result = computeStatusStrip(healthOperational, quota);
    expect(result!.level).toBe('block');
    expect(result!.message).toContain('Hourly rate limit reached');
  });

  it('handles null health gracefully', () => {
    const result = computeStatusStrip(null, quotaAllClear);
    expect(result).toBeNull();
  });

  it('handles null quota gracefully', () => {
    const result = computeStatusStrip(healthOperational, null);
    expect(result).toBeNull();
  });

  it('handles both null inputs', () => {
    const result = computeStatusStrip(null, null);
    expect(result).toBeNull();
  });

  it('treats unknown health status as operational (optimistic)', () => {
    const health = { ...healthOperational, status: 'unknown' };
    const result = computeStatusStrip(health, quotaAllClear);
    expect(result).toBeNull();
  });

  it('handles null daily_cap_cents (no cap configured)', () => {
    const quota = { ...quotaAllClear, daily_cap_cents: null, spent_today_cents: 9999 };
    const result = computeStatusStrip(healthOperational, quota);
    expect(result).toBeNull();
  });

  it('handles null rate_limit_hour (no rate limit configured)', () => {
    const quota = { ...quotaAllClear, rate_limit_hour: null, rate_used_hour: 999 };
    const result = computeStatusStrip(healthOperational, quota);
    expect(result).toBeNull();
  });

  it('near-limit warning takes priority over active incidents', () => {
    const health = {
      ...healthOperational,
      incidents: [{ name: 'Some incident', status: 'monitoring', impact: 'minor' }],
    };
    const quota = { ...quotaAllClear, daily_cap_cents: 1000, spent_today_cents: 900 };
    const result = computeStatusStrip(health, quota);
    expect(result!.level).toBe('warn');
    expect(result!.message).toContain('90%');
  });

  it('does not warn below 80% of daily cap', () => {
    const quota = { ...quotaAllClear, daily_cap_cents: 1000, spent_today_cents: 790 };
    const result = computeStatusStrip(healthOperational, quota);
    expect(result).toBeNull();
  });
});
