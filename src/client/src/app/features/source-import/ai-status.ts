export type AiStatusLevel = 'block' | 'warn' | 'info' | 'clear';

export interface AiStatusStrip {
  level: AiStatusLevel;
  message: string;
}

export interface AiImportStatusResult {
  ai_enabled: boolean;
  daily_cap_cents: number | null;
  spent_today_cents: number;
  rate_used_hour: number;
  rate_limit_hour: number | null;
}

export interface AiHealthResult {
  status: string;
  description: string;
  indicator: string;
  incidents: { name: string; status: string; impact: string }[];
  checked_at: string;
}

export function computeStatusStrip(
  health: AiHealthResult | null,
  quota: AiImportStatusResult | null,
): AiStatusStrip | null {
  if (health?.status === 'major_outage') {
    return {
      level: 'block',
      message:
        'The AI service is currently experiencing an outage. Import is unavailable until the service recovers.',
    };
  }

  if (health?.status === 'partial_outage') {
    return {
      level: 'warn',
      message: 'The AI service is experiencing partial disruptions. Import may fail or be slow.',
    };
  }

  if (health?.status === 'degraded_performance') {
    return {
      level: 'warn',
      message: 'The AI service is running with reduced performance. Import may be slower than usual.',
    };
  }

  if (quota && quota.ai_enabled === false) {
    return {
      level: 'block',
      message:
        'AI-assisted import is not enabled for this organization. Contact your admin to enable it.',
    };
  }

  if (
    quota &&
    quota.daily_cap_cents !== null &&
    quota.spent_today_cents >= quota.daily_cap_cents
  ) {
    return {
      level: 'block',
      message: `Daily AI usage limit reached (resets at midnight UTC). ${quota.spent_today_cents}/${quota.daily_cap_cents} used today.`,
    };
  }

  if (
    quota &&
    quota.rate_limit_hour !== null &&
    quota.rate_used_hour >= quota.rate_limit_hour
  ) {
    return {
      level: 'block',
      message: `Hourly rate limit reached (${quota.rate_used_hour}/${quota.rate_limit_hour} calls this hour). Try again shortly.`,
    };
  }

  if (
    quota &&
    quota.daily_cap_cents !== null &&
    quota.daily_cap_cents > 0 &&
    quota.spent_today_cents >= quota.daily_cap_cents * 0.8
  ) {
    const pct = Math.round((quota.spent_today_cents / quota.daily_cap_cents) * 100);
    const remainingCents = quota.daily_cap_cents - quota.spent_today_cents;
    return {
      level: 'warn',
      message: `AI usage at ${pct}% of daily limit. ${remainingCents} cents remaining today.`,
    };
  }

  if (health?.incidents && health.incidents.length > 0) {
    const incident = health.incidents[0];
    return {
      level: 'info',
      message: `The AI service has an active incident: ${incident.name}.`,
    };
  }

  return null;
}
