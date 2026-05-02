/**
 * CORS helpers for the materials worker. Origin must match the apex
 * exactly or be a subdomain of one of the allow-listed apexes.
 */

export function isAllowedOrigin(origin: string | null, allowedApexes: string[]): boolean {
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  for (const apex of allowedApexes) {
    if (host === apex) return true;
    if (host.endsWith(`.${apex}`)) return true;
  }
  return false;
}

export function corsHeaders(
  origin: string | null,
  allowedApexes: string[]
): Record<string, string> {
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (isAllowedOrigin(origin, allowedApexes)) {
    headers['Access-Control-Allow-Origin'] = origin as string;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

export function preflight(request: Request, allowedApexes: string[]): Response {
  const origin = request.headers.get('Origin');
  if (!isAllowedOrigin(origin, allowedApexes)) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin, allowedApexes),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
    },
  });
}
