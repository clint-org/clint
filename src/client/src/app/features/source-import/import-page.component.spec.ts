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

  // Token-based, privacy-correct quota shape (mirrors get_tenant_ai_status).
  // daily_usage_pct is a rolling-24h percentage; it is null for non-owners,
  // who never see organisation-level usage.
  const quotaAllClear = {
    ai_enabled: true,
    daily_usage_pct: 20,
    per_user_rate_per_min: 6,
    per_user_rate_per_hour: 60,
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

  it('priority 2: returns warn on partial outage', () => {
    const health = { ...healthOperational, status: 'partial_outage' };
    const result = computeStatusStrip(health, quotaAllClear);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('warn');
    expect(result!.message).toContain('partial disruptions');
  });

  it('priority 3: returns warn on degraded performance', () => {
    const health = { ...healthOperational, status: 'degraded_performance' };
    const result = computeStatusStrip(health, quotaAllClear);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('warn');
    expect(result!.message).toContain('reduced performance');
  });

  it('priority 4: returns block when AI is disabled', () => {
    const quota = { ...quotaAllClear, ai_enabled: false };
    const result = computeStatusStrip(healthOperational, quota);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('block');
    expect(result!.message).toContain('not enabled');
  });

  it('priority 5: returns block when daily usage reaches 100%', () => {
    const quota = { ...quotaAllClear, daily_usage_pct: 100 };
    const result = computeStatusStrip(healthOperational, quota);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('block');
    expect(result!.message).toContain('Daily AI usage limit reached');
  });

  it('priority 5: treats usage above 100% as exhausted (defensive)', () => {
    const quota = { ...quotaAllClear, daily_usage_pct: 130 };
    const result = computeStatusStrip(healthOperational, quota);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('block');
    expect(result!.message).toContain('Daily AI usage limit reached');
  });

  it('priority 6: returns warn at 80%+ of daily usage', () => {
    const quota = { ...quotaAllClear, daily_usage_pct: 85 };
    const result = computeStatusStrip(healthOperational, quota);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('warn');
    expect(result!.message).toContain('85%');
  });

  it('priority 6: returns warn at exactly 80%', () => {
    const quota = { ...quotaAllClear, daily_usage_pct: 80 };
    const result = computeStatusStrip(healthOperational, quota);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('warn');
    expect(result!.message).toContain('80%');
  });

  it('priority 7: returns info on active incidents', () => {
    const health = {
      ...healthOperational,
      incidents: [{ name: 'Elevated error rates', status: 'investigating', impact: 'minor' }],
    };
    const result = computeStatusStrip(health, quotaAllClear);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('info');
    expect(result!.message).toContain('Elevated error rates');
  });

  it('major outage takes priority over AI disabled', () => {
    const health = { ...healthOperational, status: 'major_outage' };
    const quota = { ...quotaAllClear, ai_enabled: false };
    const result = computeStatusStrip(health, quota);
    expect(result!.level).toBe('block');
    expect(result!.message).toContain('outage');
  });

  it('AI disabled takes priority over usage exhausted', () => {
    const quota = { ...quotaAllClear, ai_enabled: false, daily_usage_pct: 100 };
    const result = computeStatusStrip(healthOperational, quota);
    expect(result!.level).toBe('block');
    expect(result!.message).toContain('not enabled');
  });

  it('usage exhausted takes priority over near-limit warning', () => {
    const quota = { ...quotaAllClear, daily_usage_pct: 100 };
    const result = computeStatusStrip(healthOperational, quota);
    expect(result!.level).toBe('block');
    expect(result!.message).toContain('Daily AI usage limit');
  });

  it('near-limit warning takes priority over active incidents', () => {
    const health = {
      ...healthOperational,
      incidents: [{ name: 'Some incident', status: 'monitoring', impact: 'minor' }],
    };
    const quota = { ...quotaAllClear, daily_usage_pct: 90 };
    const result = computeStatusStrip(health, quota);
    expect(result!.level).toBe('warn');
    expect(result!.message).toContain('90%');
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

  it('handles null daily_usage_pct (non-owner, no usage visibility)', () => {
    const quota = { ...quotaAllClear, daily_usage_pct: null };
    const result = computeStatusStrip(healthOperational, quota);
    expect(result).toBeNull();
  });

  it('does not warn below 80% of daily usage', () => {
    const quota = { ...quotaAllClear, daily_usage_pct: 79 };
    const result = computeStatusStrip(healthOperational, quota);
    expect(result).toBeNull();
  });
});
