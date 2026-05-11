export function renderSurfacesIndex(collection) {
  const rows = collection.surfaces
    .map((surf) => {
      const summary =
        surf.frontmatter?.summary ??
        collection.capabilities.find((c) => c.surface === surf.name)?.summary ??
        '_(no summary)_';
      return {
        name: surf.name,
        summary,
        file: surf.file,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const header = '| Surface | Summary | File |\n|---|---|---|';
  const body = rows
    .map((r) => `| ${r.name} | ${r.summary} | [${r.file}](features/${r.file}) |`)
    .join('\n');

  return `${header}\n${body}`;
}
