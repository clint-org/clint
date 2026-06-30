import { describe, it, expect } from 'vitest';
import { handleEvidenceGet } from '../evidence';

function bucketWith(objects: Record<string, string>) {
  return {
    get: async (key: string) =>
      key in objects
        ? { body: new Response(objects[key]).body, httpMetadata: { contentType: 'image/png' } }
        : null,
  } as unknown as R2Bucket;
}

const env = (objects: Record<string, string>) =>
  ({ EVIDENCE_BUCKET: bucketWith(objects) }) as unknown as Parameters<typeof handleEvidenceGet>[1];

describe('handleEvidenceGet', () => {
  it('streams an existing issues/ object', async () => {
    const res = await handleEvidenceGet(
      new Request('https://clintapp.com/evidence/issues/157/after-prod.png'),
      env({ 'issues/157/after-prod.png': 'PNGDATA' })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(await res.text()).toBe('PNGDATA');
  });

  it('404s a missing object', async () => {
    const res = await handleEvidenceGet(
      new Request('https://clintapp.com/evidence/issues/157/missing.png'),
      env({})
    );
    expect(res.status).toBe(404);
  });

  it('405s a non-GET', async () => {
    const res = await handleEvidenceGet(
      new Request('https://clintapp.com/evidence/issues/157/x.png', { method: 'POST' }),
      env({ 'issues/157/x.png': 'X' })
    );
    expect(res.status).toBe(405);
  });

  it('400s a key that escapes the issues/ prefix', async () => {
    const res = await handleEvidenceGet(
      new Request('https://clintapp.com/evidence/../secrets.txt'),
      env({ 'issues/157/x.png': 'X' })
    );
    expect(res.status).toBe(400);
  });
});
