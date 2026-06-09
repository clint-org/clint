// Host-aware robots.txt. The apex (marketing site) is crawlable but app and
// auth paths are disallowed. Every workspace subdomain is fully disallowed so
// client workspaces are never indexed and the client list stays private.
export function buildRobots(host: string, apexes: string[]): string {
  const isApex = apexes.some((a) => a.trim().toLowerCase() === host.toLowerCase());
  if (isApex) {
    return [
      'User-agent: *',
      'Disallow: /login',
      'Disallow: /auth',
      'Disallow: /admin',
      'Disallow: /super-admin',
      '',
    ].join('\n');
  }
  return ['User-agent: *', 'Disallow: /', ''].join('\n');
}
