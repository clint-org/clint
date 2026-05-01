/**
 * Tiny DSL for "as <persona>, do <op>" matrix tests.
 *
 * `as(personas, 'reader')` returns a Supabase client that sends the persona's
 * JWT on every request. `as(personas, 'anon')` returns a client with no
 * Authorization header (the "no auth" matrix case).
 *
 * Assertion helpers cover the four common shapes we expect from PostgREST:
 *   - 42501  RLS denial / RPC permission gate / our trigger raises
 *   - PGRST  PostgREST-level errors (e.g. RPC not found, malformed query)
 *   - ok     successful 2xx response
 *   - count  successful response with a specific row count
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Personas, PersonaName } from '../fixtures/personas';

export type SupabaseError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

export function as(personas: Personas, name: PersonaName): SupabaseClient {
  const jwt = personas.jwts[name];
  const headers: Record<string, string> = { apikey: personas.anonKey };
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
  return createClient(personas.url, personas.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers },
  });
}

/** Assert the response carries the expected Postgres SQLSTATE code. */
export function expectCode(
  result: { error: SupabaseError | null; data: unknown },
  code: string,
  messageContains?: string,
): void {
  if (!result.error) {
    throw new Error(
      `expected error code ${code}, got ok with data: ${JSON.stringify(result.data)?.slice(0, 200)}`,
    );
  }
  if (result.error.code !== code) {
    throw new Error(
      `expected error code ${code}, got ${result.error.code}: ${result.error.message}`,
    );
  }
  if (messageContains && !(result.error.message ?? '').includes(messageContains)) {
    throw new Error(
      `expected error message to contain ${JSON.stringify(messageContains)}, got: ${result.error.message}`,
    );
  }
}

/** Assert a successful (no-error) response. */
export function expectOk<T>(result: { error: SupabaseError | null; data: T }): T {
  if (result.error) {
    throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  }
  return result.data;
}

/** Assert a successful response with a specific row count. */
export function expectCount(
  result: { error: SupabaseError | null; data: unknown[] | null },
  count: number,
): void {
  expectOk(result);
  const len = result.data?.length ?? 0;
  if (len !== count) {
    throw new Error(`expected ${count} rows, got ${len}: ${JSON.stringify(result.data)?.slice(0, 200)}`);
  }
}
