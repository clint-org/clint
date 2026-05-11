export function findNear(collection, filters) {
  const hits = [];
  for (const cap of collection.capabilities) {
    let overlap = 0;
    const reasons = [];
    if (filters.tables) {
      const matches = (cap.tables || []).filter((t) => filters.tables.includes(t));
      overlap += matches.length;
      if (matches.length) reasons.push(`tables=${matches.join(',')}`);
    }
    if (filters.rpcs) {
      const matches = (cap.rpcs || []).filter((r) => filters.rpcs.includes(r));
      overlap += matches.length;
      if (matches.length) reasons.push(`rpcs=${matches.join(',')}`);
    }
    if (filters.routes) {
      const matches = (cap.routes || []).filter((r) => filters.routes.includes(r));
      overlap += matches.length;
      if (matches.length) reasons.push(`routes=${matches.join(',')}`);
    }
    if (overlap > 0) {
      hits.push({ id: cap.id, surface: cap.surface, overlap, reasons });
    }
  }
  hits.sort((a, b) => b.overlap - a.overlap);
  return hits;
}
