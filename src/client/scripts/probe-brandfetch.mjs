#!/usr/bin/env node
// Local probe that mirrors the worker's enrichCompanyLogos: HEAD-request
// symbol/icon/logo in order with browser-like headers and pick the first
// whose ETag is not the known Brandfetch placeholder. Run before pushing
// when touching logo-enrichment.ts to confirm the CDN still behaves and
// the placeholder ETag hasn't drifted.
//
// Usage:
//   node scripts/probe-brandfetch.mjs \
//     lilly.com novonordisk.com boehringer-ingelheim.com

const CLIENT_ID = '1idkTE42LH-0X2u_ymo';
const REFERER = 'https://dev.clintapp.com/';
const PLACEHOLDER_ETAGS = new Set([
  '"50d0-2qeW7LHRdpFgBCxSKMv6Q0bjCeY"',
]);
const TYPE_PREFERENCE = ['symbol', 'icon', 'logo'];

async function probe(domain, type) {
  const url = `https://cdn.brandfetch.io/${domain}/${type}?c=${CLIENT_ID}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Referer: REFERER,
      Origin: REFERER.replace(/\/$/, ''),
      Accept: 'image/webp,image/*',
      'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0',
      Range: 'bytes=0-0',
    },
  });
  return {
    ok: res.status === 200 || res.status === 206,
    status: res.status,
    etag: res.headers.get('etag'),
  };
}

async function pickType(domain) {
  for (const type of TYPE_PREFERENCE) {
    const r = await probe(domain, type);
    const isPlaceholder = r.etag != null && PLACEHOLDER_ETAGS.has(r.etag);
    console.log(`  ${type}: ${r.status} etag=${r.etag} placeholder=${isPlaceholder}`);
    if (r.ok && !isPlaceholder) return type;
  }
  return null;
}

const domains = process.argv.slice(2);
if (domains.length === 0) {
  domains.push('lilly.com', 'novonordisk.com', 'boehringer-ingelheim.com');
}

for (const domain of domains) {
  console.log(`\n${domain}:`);
  const picked = await pickType(domain);
  console.log(
    picked
      ? `  -> store https://cdn.brandfetch.io/${domain}/${picked}`
      : `  -> no enrichment`,
  );
}
