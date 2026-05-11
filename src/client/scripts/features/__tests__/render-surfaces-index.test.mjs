import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSurfacesIndex } from '../render-surfaces-index.mjs';

test('renders a sorted markdown table of surfaces', () => {
  const collection = {
    surfaces: [
      { file: 'timeline-dashboard.md', name: 'Timeline Dashboard', frontmatter: { summary: 'Primary view.' } },
      { file: 'command-palette.md', name: 'Command Palette', frontmatter: { summary: 'Cmd+K finder.' } },
    ],
    capabilities: [],
    errors: [],
  };
  const md = renderSurfacesIndex(collection);
  assert.match(md, /\| Surface \| Summary \| File \|/);
  const cpIdx = md.indexOf('Command Palette');
  const tdIdx = md.indexOf('Timeline Dashboard');
  assert.ok(cpIdx > 0 && cpIdx < tdIdx);
  assert.match(md, /\[command-palette\.md\]\(features\/command-palette\.md\)/);
});

test('falls back to derived summary when frontmatter has none', () => {
  const collection = {
    surfaces: [{ file: 'foo.md', name: 'Foo', frontmatter: {} }],
    capabilities: [{ surface: 'Foo', summary: 'First capability does X.', sourceFile: 'foo.md' }],
    errors: [],
  };
  const md = renderSurfacesIndex(collection);
  assert.match(md, /First capability does X\./);
});

test('handles surface with no summary and no capabilities', () => {
  const collection = {
    surfaces: [{ file: 'empty.md', name: 'Empty', frontmatter: {} }],
    capabilities: [],
    errors: [],
  };
  const md = renderSurfacesIndex(collection);
  assert.match(md, /\(no summary\)/);
});
