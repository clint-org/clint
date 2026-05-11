// Compare parsed capabilities against live sources.
// Returns { errors, warnings, skipped }.

export function checkDrift(collection, live, opts = {}) {
  const skipTags = {
    routes: {},
    rpcs: {},
    tables: {},
    ...(opts.skipTags || {}),
  };

  const errors = [];
  const warnings = [];
  const skipped = [];

  for (const e of collection.errors) {
    errors.push({ kind: 'parse-error', message: e.message, file: e.file, id: e.id });
  }

  const allIds = new Set(collection.capabilities.map((c) => c.id));
  const mappedRoutes = new Set();
  const mappedRpcs = new Set();
  const mappedTables = new Set();

  for (const cap of collection.capabilities) {
    if (/^TODO/i.test(cap.id)) {
      errors.push({
        kind: 'todo-id',
        id: cap.id,
        file: cap.sourceFile,
        message: `capability has TODO id; rename before merging`,
      });
    }

    for (const r of cap.routes || []) {
      mappedRoutes.add(r);
      if (!live.routes.has(stripLeadingSlash(r))) {
        errors.push({
          kind: 'route-not-in-code',
          id: cap.id,
          file: cap.sourceFile,
          message: `capability ${cap.id}: route ${r} does not exist in app.routes.ts`,
        });
      }
    }
    for (const rpc of cap.rpcs || []) {
      mappedRpcs.add(rpc);
      if (!live.rpcs.has(rpc)) {
        errors.push({
          kind: 'rpc-not-in-db',
          id: cap.id,
          file: cap.sourceFile,
          message: `capability ${cap.id}: rpc ${rpc} does not exist in pg_proc`,
        });
      }
    }
    for (const t of cap.tables || []) {
      mappedTables.add(t);
      if (!live.tables.has(t)) {
        errors.push({
          kind: 'table-not-in-db',
          id: cap.id,
          file: cap.sourceFile,
          message: `capability ${cap.id}: table ${t} does not exist in pg_class`,
        });
      }
    }
    for (const ref of cap.related || []) {
      if (!allIds.has(ref)) {
        errors.push({
          kind: 'related-broken',
          id: cap.id,
          file: cap.sourceFile,
          message: `capability ${cap.id}: related id ${ref} does not exist`,
        });
      }
    }
  }

  for (const r of live.routes) {
    if (skipTags.routes[r]) {
      skipped.push({ kind: 'route', target: r, reason: skipTags.routes[r] });
      continue;
    }
    if (!mappedRoutes.has('/' + r) && !mappedRoutes.has(r)) {
      warnings.push({
        kind: 'route-unmapped',
        message: `route /${r} exists in code but no capability maps it`,
      });
    }
  }
  for (const rpc of live.rpcs) {
    if (skipTags.rpcs[rpc]) {
      skipped.push({ kind: 'rpc', target: rpc, reason: skipTags.rpcs[rpc] });
      continue;
    }
    if (!mappedRpcs.has(rpc)) {
      errors.push({
        kind: 'rpc-unmapped',
        message: `rpc ${rpc} exists in pg_proc but no capability maps it`,
      });
    }
  }
  for (const t of live.tables) {
    if (skipTags.tables[t]) {
      skipped.push({ kind: 'table', target: t, reason: skipTags.tables[t] });
      continue;
    }
    if (!mappedTables.has(t)) {
      warnings.push({
        kind: 'table-unmapped',
        message: `table ${t} exists in pg_class but no capability maps it`,
      });
    }
  }

  return { errors, warnings, skipped };
}

function stripLeadingSlash(s) {
  return s.startsWith('/') ? s.slice(1) : s;
}
