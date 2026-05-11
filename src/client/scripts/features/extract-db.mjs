// Live extractors for public-schema RPCs and tables.
// Used by the drift CLI to compare against capabilities mappings.

import pg from 'pg';

async function withClient(connectionString, fn) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function extractRpcs(connectionString) {
  return withClient(connectionString, async (client) => {
    const { rows } = await client.query(`
      select p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
      order by p.proname
    `);
    return new Set(rows.map((r) => r.proname));
  });
}

export async function extractTables(connectionString) {
  return withClient(connectionString, async (client) => {
    const { rows } = await client.query(`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname
    `);
    return new Set(rows.map((r) => r.relname));
  });
}
