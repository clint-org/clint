import type { Env } from './index';

/**
 * Public, read-only GET of an evidence screenshot. Only objects under the
 * `issues/` prefix are reachable; the key is taken verbatim from the path after
 * `/evidence/` and rejected if it does not start with `issues/` or contains `..`.
 * No listing, no write, no auth -- these are synthetic dev shots and post-fix prod
 * shots linked from GitHub issue comments (GitHub's camo proxy needs a public URL).
 */
export async function handleEvidenceGet(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return new Response('method not allowed', { status: 405 });
  const key = new URL(request.url).pathname.replace(/^\/evidence\//, '');
  if (!key.startsWith('issues/') || key.includes('..')) {
    return new Response('bad key', { status: 400 });
  }
  const obj = await env.EVIDENCE_BUCKET.get(key);
  if (!obj) return new Response('not found', { status: 404 });
  return new Response(obj.body, {
    status: 200,
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'image/png',
      'cache-control': 'public, max-age=86400',
    },
  });
}
