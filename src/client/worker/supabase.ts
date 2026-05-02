import type { SupabaseRpcError } from './errors';

export type SupabaseConfig = {
  url: string;       // https://<project>.supabase.co
  anonKey: string;   // public anon key
};

/**
 * Calls a Postgres RPC via PostgREST, forwarding the user's JWT so RLS
 * applies. Returns the JSON body on success or throws a SupabaseRpcError.
 */
export async function callRpc<T = unknown>(
  cfg: SupabaseConfig,
  authHeader: string | null,
  fnName: string,
  args: Record<string, unknown>
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: cfg.anonKey,
  };
  if (authHeader) headers['Authorization'] = authHeader;

  const res = await fetch(`${cfg.url}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
  });

  if (res.ok) {
    return (await res.json()) as T;
  }

  // PostgREST returns { code, message, details, hint } for SQL errors.
  let body: { code?: string; message?: string } = {};
  try {
    body = (await res.json()) as { code?: string; message?: string };
  } catch {
    // ignore: body is not json
  }
  const err: SupabaseRpcError = {
    code: body.code,
    message: body.message,
    httpStatus: res.status,
  };
  throw err;
}
