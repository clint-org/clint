import { execFileSync } from 'node:child_process';

// Pure diff: returns the three divergence classes between the DB pointer set,
// the R2 object set, and the B2 object set. Exported for unit testing.
export function diff(db, r2, b2) {
  const dangling  = [...db].filter((k) => !r2.has(k)); // row, no object
  const orphan    = [...r2].filter((k) => !db.has(k)); // object, no row
  const mirrorGap = [...r2].filter((k) => !b2.has(k)); // in R2, not in B2
  return { dangling, orphan, mirror_gap: mirrorGap };
}

// Severity: a real upload that lost its file (dangling) or a backup that has
// fallen behind (mirror_gap) fail the job. An orphan (R2 object with no DB row)
// is wasted storage, not data loss; it is reported but does not fail.
export function failsOn(summary) {
  return summary.dangling.length > 0 || summary.mirror_gap.length > 0;
}

function s3Keys(bucket, endpoint, accessKeyId, secretAccessKey) {
  const out = execFileSync(
    'aws',
    ['s3api', 'list-objects-v2', '--bucket', bucket, '--endpoint-url', endpoint,
     '--query', 'Contents[].Key', '--output', 'text'],
    { env: { ...process.env, AWS_ACCESS_KEY_ID: accessKeyId, AWS_SECRET_ACCESS_KEY: secretAccessKey }, encoding: 'utf8' }
  );
  return new Set(out.split(/\s+/).filter(Boolean));
}

function dbPaths(poolerUrl) {
  // Exclude is_sample rows: seed/demo/playground materials intentionally have no
  // backing R2 object, so they must not count as dangling.
  const out = execFileSync('psql', [poolerUrl, '-At', '-c', 'select file_path from public.materials where not is_sample'], { encoding: 'utf8' });
  return new Set(out.split('\n').filter(Boolean));
}

function main() {
  const db = dbPaths(process.env.DB_POOLER_URL);
  const r2 = s3Keys(process.env.R2_BUCKET, process.env.R2_S3_ENDPOINT, process.env.R2_ACCESS_KEY_ID, process.env.R2_SECRET_ACCESS_KEY);
  const b2 = s3Keys(process.env.B2_BUCKET, process.env.B2_S3_ENDPOINT, process.env.B2_KEY_ID, process.env.B2_APP_KEY);
  const summary = diff(db, r2, b2);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(failsOn(summary) ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
