import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { extractRpcs, extractTables } from '../extract-db.mjs';

const DB_URL =
  process.env.SUPABASE_DB_URL ||
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function isDbReachable() {
  const client = new pg.Client({ connectionString: DB_URL });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

test('returns the live list of public RPCs', { skip: !(await isDbReachable()) }, async () => {
  const rpcs = await extractRpcs(DB_URL);
  assert.ok(rpcs instanceof Set);
  assert.ok(rpcs.size > 0, 'expected at least one public RPC');
  assert.ok(rpcs.has('get_brand_by_host'), 'expected get_brand_by_host in pg_proc');
});

test('returns the live list of public tables', { skip: !(await isDbReachable()) }, async () => {
  const tables = await extractTables(DB_URL);
  assert.ok(tables instanceof Set);
  assert.ok(tables.has('tenants'), 'expected tenants table');
});
