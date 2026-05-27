let cached: { body: string; expires: number } | null = null;

export async function handleAiHealth(
  _env: unknown,
  cors: Record<string, string>
): Promise<Response> {
  const now = Date.now();
  if (cached && cached.expires > now) {
    return new Response(cached.body, {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  let health: {
    status: string;
    description: string;
    indicator: string;
    incidents: { name: string; status: string; impact: string }[];
    checked_at: string;
  };

  try {
    const res = await fetch('https://status.claude.com/api/v2/summary.json', {
      signal: AbortSignal.timeout(5000),
    });
    const summary = (await res.json()) as any;

    const apiComponent = summary.components?.find(
      (c: any) => c.name === 'Claude API'
    );

    health = {
      status: apiComponent?.status ?? 'unknown',
      description: summary.status?.description ?? '',
      indicator: summary.status?.indicator ?? 'none',
      incidents: (summary.incidents ?? []).map((i: any) => ({
        name: i.name,
        status: i.status,
        impact: i.impact,
      })),
      checked_at: new Date().toISOString(),
    };
  } catch {
    health = {
      status: 'unknown',
      description: 'Unable to check AI service status',
      indicator: 'none',
      incidents: [],
      checked_at: new Date().toISOString(),
    };
  }

  const body = JSON.stringify(health);
  cached = { body, expires: now + 60_000 };

  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}
