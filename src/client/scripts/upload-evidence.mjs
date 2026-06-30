import { execFileSync } from 'node:child_process';

const BUCKET = 'clint-evidence';
const BASE = 'https://clintapp.com/evidence';

export const objectKeyFor = (issue, name) => `issues/${issue}/${name}`;
export const publicUrlFor = (issue, name) => `${BASE}/${objectKeyFor(issue, name)}`;

function main() {
  const [issue, file, name] = process.argv.slice(2);
  if (!issue || !file || !name) {
    console.error('usage: node scripts/upload-evidence.mjs <issue#> <local-png-path> <name>');
    process.exit(2);
  }
  execFileSync(
    'npx',
    ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${objectKeyFor(issue, name)}`, '--file', file, '--remote', '--content-type', 'image/png'],
    { stdio: 'inherit' }
  );
  console.log(`EVIDENCE_URL=${publicUrlFor(issue, name)}`);
}

// Run only when invoked directly, not when imported by the test.
if (import.meta.url === `file://${process.argv[1]}`) main();
