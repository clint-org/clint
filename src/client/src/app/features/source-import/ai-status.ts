export type AiStatusLevel = 'block' | 'warn' | 'info' | 'clear';

export interface AiStatusStrip {
  level: AiStatusLevel;
  message: string;
}

export interface AiImportStatusResult {
  ai_enabled: boolean;
  // Rolling-24h usage as a percentage of the tenant's daily token cap.
  // Null for non-owners: organisation-level usage is never exposed to them
  // (mirrors get_tenant_ai_status, which gates the percentage behind ownership).
  daily_usage_pct: number | null;
  per_user_rate_per_min: number | null;
  per_user_rate_per_hour: number | null;
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
  quota: AiImportStatusResult | null
): AiStatusStrip | null {
  // We only surface states the user can actually act on: a hard outage that
  // blocks import, and the user's own quota/rate situation. Softer upstream
  // status (partial_outage, degraded_performance) and the status-page
  // incidents[] feed are deliberately NOT shown -- they are non-actionable
  // and lingered for days, reading as noise to end users.
  if (health?.status === 'major_outage') {
    return {
      level: 'block',
      message:
        'The AI service is currently experiencing an outage. Import is unavailable until the service recovers.',
    };
  }

  if (quota && quota.ai_enabled === false) {
    return {
      level: 'block',
      message:
        'AI-assisted import is not enabled for this organization. Contact your admin to enable it.',
    };
  }

  // Daily usage is a rolling-24h percentage of the tenant token cap. It is only
  // populated for tenant owners/platform admins; non-owners get null and see no
  // usage strip. Per-user rate limits are enforced server-side at preflight
  // (HTTP 429 + a countdown in the import dialog), so they are not surfaced here.
  if (quota && quota.daily_usage_pct !== null && quota.daily_usage_pct >= 100) {
    return {
      level: 'block',
      message: 'Daily AI usage limit reached. It resets on a rolling 24-hour basis.',
    };
  }

  if (quota && quota.daily_usage_pct !== null && quota.daily_usage_pct >= 80) {
    return {
      level: 'warn',
      message: `AI usage at ${quota.daily_usage_pct}% of the daily limit.`,
    };
  }

  return null;
}
