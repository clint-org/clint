/**
 * Presentation parts for the Events grid "Entity" column (design option C):
 * a level badge, the most-specific entity name, and the parent path trailing
 * muted. Pure so it is trivially testable and safe to call per row.
 *
 * The badge reflects the row's own level (Company / Asset / Trial / Industry),
 * which for analyst events can be any level per the New Event entity picker;
 * markers and detected changes are always trial-level. "Industry" (space) is
 * self-explanatory, so its value is suppressed to avoid "Industry Industry".
 */
export interface EntityCellParts {
  badge: string;
  value: string;
  parents: string[];
}

const LEVEL_LABEL: Record<string, string> = {
  trial: 'Trial',
  product: 'Asset',
  company: 'Company',
  space: 'Industry',
};

export interface EntityCellInput {
  entity_level: string;
  entity_name: string;
  company_name: string | null;
  asset_name: string | null;
}

export function entityCellParts(item: EntityCellInput): EntityCellParts {
  const level = item.entity_level;
  const badge = LEVEL_LABEL[level] ?? level;
  const parents: string[] = [];
  let value = item.entity_name ?? '';

  if (level === 'space') {
    value = '';
  } else if (level === 'trial') {
    if (item.company_name) parents.push(item.company_name);
    if (item.asset_name) parents.push(item.asset_name);
  } else if (level === 'product') {
    if (item.company_name) parents.push(item.company_name);
  }

  return { badge, value, parents };
}
