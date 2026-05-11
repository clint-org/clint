import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseSurface } from './parse-surface.mjs';

const REQUIRED_FIELDS = [
  'id',
  'summary',
  'routes',
  'rpcs',
  'tables',
  'related',
  'user_facing',
  'role',
  'status',
];

const VALID_ROLES = new Set(['viewer', 'editor', 'owner', 'agency', 'super-admin']);
const VALID_STATUSES = new Set(['active', 'experimental', 'deprecated']);

export async function parseAll(featuresDir, fileWhitelist = null) {
  const all = await readdir(featuresDir);
  const files = (fileWhitelist ?? all.filter((f) => f.endsWith('.md'))).sort();

  const surfaces = [];
  const capabilities = [];
  const errors = [];
  const idSeen = new Map();

  for (const file of files) {
    const filePath = resolve(featuresDir, file);
    let parsed;
    try {
      parsed = await parseSurface(filePath);
    } catch (err) {
      errors.push({ file, message: err.message });
      continue;
    }

    surfaces.push({
      file,
      filePath,
      name: parsed.surfaceName,
      frontmatter: parsed.frontmatter,
    });

    for (const cap of parsed.capabilities) {
      for (const field of REQUIRED_FIELDS) {
        if (!(field in cap)) {
          errors.push({
            file,
            id: cap.id ?? '(unknown)',
            message: `capability missing required field: ${field}`,
          });
        }
      }
      if (cap.role && !VALID_ROLES.has(cap.role)) {
        errors.push({
          file,
          id: cap.id,
          message: `invalid role: ${cap.role} (allowed: ${[...VALID_ROLES].join(', ')})`,
        });
      }
      if (cap.status && !VALID_STATUSES.has(cap.status)) {
        errors.push({
          file,
          id: cap.id,
          message: `invalid status: ${cap.status} (allowed: ${[...VALID_STATUSES].join(', ')})`,
        });
      }
      if (cap.id) {
        if (idSeen.has(cap.id)) {
          errors.push({
            file,
            id: cap.id,
            message: `duplicate id ${cap.id} (also defined in ${idSeen.get(cap.id)})`,
          });
        } else {
          idSeen.set(cap.id, file);
        }
      }
      capabilities.push({ ...cap, surface: parsed.surfaceName, sourceFile: file });
    }
  }

  return { surfaces, capabilities, errors };
}
