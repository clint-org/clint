import { jwtSubject } from './auth';
import { isAllowedOrigin, corsHeaders, preflight } from './cors';
import { mapSupabaseError, errorResponse, type SupabaseRpcError } from './errors';
import { callRpc } from './supabase';
import { presignPut, presignGet } from './r2';

type RateLimit = { limit: (key: { key: string }) => Promise<{ success: boolean }> };

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET: string;
  ALLOWED_APEXES: string; // comma-separated list, e.g. "clintapp.com"
  UPLOAD_LIMITER: RateLimit;
  DOWNLOAD_LIMITER: RateLimit;
  ASSETS?: { fetch: (req: Request) => Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const apexes = env.ALLOWED_APEXES.split(',').map((s) => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return preflight(request, apexes);
    }

    const cors = corsHeaders(origin, apexes);

    if (url.pathname === '/api/materials/sign-upload' && request.method === 'POST') {
      return handleSignUpload(request, env, cors);
    }
    if (url.pathname === '/api/materials/sign-download' && request.method === 'POST') {
      return handleSignDownload(request, env, cors);
    }

    if (url.pathname.startsWith('/api/')) {
      return errorResponse(404, 'not_found', cors);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return errorResponse(404, 'not_found', cors);
  },
};

async function handleSignUpload(request: Request, env: Env, cors: Record<string, string>) {
  const start = Date.now();
  const auth = request.headers.get('Authorization');
  const key = jwtSubject(auth) ?? request.headers.get('CF-Connecting-IP') ?? 'anon';

  const rl = await env.UPLOAD_LIMITER.limit({ key: `upload:${key}` });
  if (!rl.success) {
    log({ route: 'sign-upload', status: 429, duration_ms: Date.now() - start });
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60', ...cors },
    });
  }

  let body: { material_id?: string };
  try {
    body = (await request.json()) as { material_id?: string };
  } catch {
    return errorResponse(400, 'invalid_json', cors);
  }
  if (!body.material_id) {
    return errorResponse(400, 'material_id_required', cors);
  }

  try {
    const meta = await callRpc<{
      space_id: string;
      material_id: string;
      file_name: string;
      mime_type: string;
    }>(
      { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY },
      auth,
      'prepare_material_upload',
      { p_material_id: body.material_id }
    );

    const objectKey = `${meta.space_id}/${meta.material_id}/${meta.file_name}`;
    const url = await presignPut(
      {
        accountId: env.R2_ACCOUNT_ID,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        bucket: env.R2_BUCKET,
      },
      objectKey,
      meta.mime_type
    );

    log({
      route: 'sign-upload',
      material_id: body.material_id,
      status: 200,
      duration_ms: Date.now() - start,
    });
    return new Response(JSON.stringify({ url, key: objectKey }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  } catch (e) {
    return handleError(e, 'sign-upload', body.material_id, start, cors);
  }
}

async function handleSignDownload(request: Request, env: Env, cors: Record<string, string>) {
  const start = Date.now();
  const auth = request.headers.get('Authorization');
  const key = jwtSubject(auth) ?? request.headers.get('CF-Connecting-IP') ?? 'anon';

  const rl = await env.DOWNLOAD_LIMITER.limit({ key: `download:${key}` });
  if (!rl.success) {
    log({ route: 'sign-download', status: 429, duration_ms: Date.now() - start });
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60', ...cors },
    });
  }

  let body: { material_id?: string };
  try {
    body = (await request.json()) as { material_id?: string };
  } catch {
    return errorResponse(400, 'invalid_json', cors);
  }
  if (!body.material_id) {
    return errorResponse(400, 'material_id_required', cors);
  }

  try {
    const meta = await callRpc<{
      file_path: string;
      file_name: string;
      mime_type: string;
    }>(
      { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY },
      auth,
      'download_material',
      { p_material_id: body.material_id }
    );

    const url = await presignGet(
      {
        accountId: env.R2_ACCOUNT_ID,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        bucket: env.R2_BUCKET,
      },
      meta.file_path,
      meta.file_name,
      meta.mime_type
    );

    log({
      route: 'sign-download',
      material_id: body.material_id,
      status: 200,
      duration_ms: Date.now() - start,
    });
    return new Response(
      JSON.stringify({ url, file_name: meta.file_name, mime_type: meta.mime_type }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...cors } }
    );
  } catch (e) {
    return handleError(e, 'sign-download', body.material_id, start, cors);
  }
}

function handleError(
  e: unknown,
  route: string,
  material_id: string | undefined,
  start: number,
  cors: Record<string, string>
): Response {
  const err = (e as SupabaseRpcError) ?? {};
  const mapped = mapSupabaseError(err);
  log({
    route,
    material_id,
    status: mapped.status,
    duration_ms: Date.now() - start,
    error: err.message,
  });
  return errorResponse(mapped.status, mapped.body.error, cors);
}

function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}
