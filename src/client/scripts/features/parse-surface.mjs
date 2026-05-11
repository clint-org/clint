// Parse a single surface markdown file:
//   - YAML frontmatter (via gray-matter)
//   - Surface name (frontmatter.surface or first H1)
//   - A fenced ```yaml block immediately under a `## Capabilities` heading
//
// Returns: { filePath, surfaceName, frontmatter, narrative, capabilities }

import { readFile } from 'node:fs/promises';
import matter from 'gray-matter';
import { parse as parseYaml } from './yaml-mini.mjs';

const CAPABILITIES_BLOCK_RE =
  /^##\s+Capabilities\s*$\n+^```yaml\b[^\n]*\n([\s\S]*?)^```\s*$/m;

export async function parseSurface(filePath) {
  const raw = await readFile(filePath, 'utf8');
  const { data: frontmatter, content } = matter(raw);

  const h1Match = content.match(/^#\s+(.+)$/m);
  const surfaceName = (frontmatter.surface ?? h1Match?.[1] ?? '').trim();
  if (!surfaceName) {
    throw new Error(`${filePath}: surface name missing (no frontmatter.surface and no H1)`);
  }

  const blockMatch = content.match(CAPABILITIES_BLOCK_RE);
  if (!blockMatch) {
    throw new Error(`${filePath}: missing \`## Capabilities\` fenced yaml block`);
  }

  const yamlText = blockMatch[1].trim();
  const capabilities = yamlText === '' || yamlText === '[]' ? [] : parseYaml(yamlText);

  if (!Array.isArray(capabilities)) {
    throw new Error(`${filePath}: capabilities block must be a YAML array`);
  }

  const narrative = content.slice(0, blockMatch.index ?? content.length).trim();

  return { filePath, surfaceName, frontmatter, narrative, capabilities };
}
