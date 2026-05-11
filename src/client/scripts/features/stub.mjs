// Build YAML stub blocks for unmapped routes/RPCs found by drift.
// Returns { stubsBySurface: { 'surface-file.md': [yamlBlock, ...] }, unsorted: [yamlBlock, ...] }.

const ROUTE_RE = /route \/(\S+) exists in code/;
const RPC_RE = /rpc (\w+) exists in pg_proc/;

export function generateStubs(report, surfaces) {
  const stubsBySurface = {};
  const unsorted = [];

  for (const entry of [...report.warnings, ...report.errors]) {
    const routeMatch = entry.message.match(ROUTE_RE);
    if (routeMatch) {
      const route = '/' + routeMatch[1];
      const surface = inferSurfaceFromRoute(route, surfaces);
      const block = stubBlock({ routes: [route] });
      if (surface) {
        (stubsBySurface[surface.file] ??= []).push(block);
      } else {
        unsorted.push(block);
      }
      continue;
    }
    const rpcMatch = entry.message.match(RPC_RE);
    if (rpcMatch) {
      const block = stubBlock({ rpcs: [rpcMatch[1]] });
      unsorted.push(block);
    }
  }

  return { stubsBySurface, unsorted };
}

function inferSurfaceFromRoute(route, surfaces) {
  const segments = route.split('/').filter((s) => s && !s.startsWith(':'));
  const tail = segments[segments.length - 1];
  if (!tail) return null;
  return surfaces.find((s) => s.file === `${tail}.md` || s.name.toLowerCase().includes(tail));
}

function stubBlock({ routes = [], rpcs = [], tables = [] }) {
  return [
    `- id: TODO-rename`,
    `  summary: TODO`,
    `  routes:${routes.length ? '\n    - ' + routes.join('\n    - ') : ' []'}`,
    `  rpcs:${rpcs.length ? '\n    - ' + rpcs.join('\n    - ') : ' []'}`,
    `  tables:${tables.length ? '\n    - ' + tables.join('\n    - ') : ' []'}`,
    `  related: []`,
    `  user_facing: true`,
    `  role: viewer`,
    `  status: experimental`,
  ].join('\n');
}
