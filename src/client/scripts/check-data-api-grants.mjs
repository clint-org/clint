#!/usr/bin/env node
// Grants drift gate: compares the live Data API grant surface on the local
// database against supabase/data-api-grants.json, the reviewed single source
// of truth (see docs/superpowers/specs/2026-06-11-data-api-least-privilege-design.md).
//
// Fails (exit 1) on any of:
//   - missing:   (table, privilege) in the matrix but not granted to
//                authenticated in the database
//   - excess:    any grant to authenticated not in the matrix (including
//                non-DML privileges like truncate/references/trigger/maintain),
//                or ANY table grant to anon (anon is zero by construction)
//   - deny-list: a service_role privilege listed in service_role_denied is
//                present in the database
//   - default-acl: the postgres-owned default ACL for public tables or
//                sequences auto-grants anon/authenticated, or the
//                service_role tables default ACL is gone
//
// Default ACL scoping matches the migration smoke
// (20260612021320_data_api_least_privilege.sql): only defaclrole = postgres
// is in scope. A platform-managed supabase_admin default ACL row also lists
// the API roles, but migrations cannot alter it and it never applies to
// migration-created objects.
//
// Usage:
//   npm run grants:check       (requires `supabase start`)
//   SUPABASE_DB_URL=... npm run grants:check

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Script lives at src/client/scripts/, repo root is three levels up.
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const MATRIX_PATH = resolve(REPO_ROOT, 'supabase/data-api-grants.json');

const DB_URL =
  process.env.SUPABASE_DB_URL ||
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const DML = ['select', 'insert', 'update', 'delete'];

function key(table, privilege) {
  return `${table}:${privilege}`;
}

async function main() {
  const matrix = JSON.parse(readFileSync(MATRIX_PATH, 'utf8'));

  // Expected authenticated surface: exact set of (table, privilege) pairs.
  const expected = new Set();
  for (const [table, entry] of Object.entries(matrix.tables)) {
    for (const priv of entry.authenticated) {
      if (!DML.includes(priv)) {
        throw new Error(`matrix invalid: ${table} grants non-DML privilege "${priv}"`);
      }
      expected.add(key(table, priv));
    }
  }

  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();

  const failures = [];

  try {
    // Every privilege type, not just DML: the migration revokes all, so any
    // residue (truncate, references, trigger, maintain) is excess too.
    const grantsQ = await client.query(`
      select grantee, table_name, lower(privilege_type) as privilege
      from information_schema.role_table_grants
      where table_schema = 'public'
        and grantee in ('anon', 'authenticated', 'service_role')
      order by grantee, table_name, privilege
    `);

    const authDb = new Set();
    const serviceDb = new Set();
    for (const row of grantsQ.rows) {
      if (row.grantee === 'anon') {
        failures.push(`excess              anon           ${row.table_name}.${row.privilege} (anon must hold zero table grants)`);
      } else if (row.grantee === 'authenticated') {
        authDb.add(key(row.table_name, row.privilege));
      } else {
        serviceDb.add(key(row.table_name, row.privilege));
      }
    }

    for (const k of expected) {
      if (!authDb.has(k)) {
        const [table, priv] = k.split(':');
        failures.push(`missing             authenticated  ${table}.${priv} (in matrix, not granted in db)`);
      }
    }
    for (const k of authDb) {
      if (!expected.has(k)) {
        const [table, priv] = k.split(':');
        failures.push(`excess              authenticated  ${table}.${priv} (granted in db, not in matrix)`);
      }
    }

    for (const [table, entry] of Object.entries(matrix.service_role_denied)) {
      for (const priv of entry.denied) {
        if (serviceDb.has(key(table, priv))) {
          failures.push(`deny-list violation service_role   ${table}.${priv} (must stay revoked)`);
        }
      }
    }

    // Default ACLs, scoped exactly like the migration smoke.
    const aclQ = await client.query(`
      select
        pg_default_acl.defaclobjtype as objtype,
        acl.grantee::regrole::text as grantee
      from pg_default_acl
      join pg_namespace on pg_namespace.oid = pg_default_acl.defaclnamespace
      cross join lateral aclexplode(pg_default_acl.defaclacl) as acl
      where pg_namespace.nspname = 'public'
        and pg_default_acl.defaclrole = 'postgres'::regrole
        and pg_default_acl.defaclobjtype in ('r', 'S')
    `);

    let serviceTablesAcl = false;
    for (const row of aclQ.rows) {
      const kind = row.objtype === 'r' ? 'tables' : 'sequences';
      if (row.grantee === 'anon' || row.grantee === 'authenticated') {
        failures.push(`default-acl         ${row.grantee.padEnd(14)} public ${kind} default ACL auto-grants this role`);
      }
      if (row.objtype === 'r' && row.grantee === 'service_role') {
        serviceTablesAcl = true;
      }
    }
    if (!serviceTablesAcl) {
      failures.push('default-acl         service_role   public tables default ACL for service_role is missing (future fixtures break)');
    }
  } finally {
    await client.end();
  }

  if (failures.length > 0) {
    console.error('Data API grants drift detected:');
    for (const f of failures.sort()) {
      console.error(`  ${f}`);
    }
    console.error(`${failures.length} violation(s). The database and supabase/data-api-grants.json must agree exactly.`);
    process.exit(1);
  }

  console.log(`Data API grants check: PASS (${expected.size} authenticated grants across ${Object.keys(matrix.tables).length} tables, anon zero, deny-list and default ACLs intact)`);
}

main().catch((err) => {
  console.error(`Data API grants check failed to run: ${err.message}`);
  process.exit(1);
});
