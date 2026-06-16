import { IntelligenceEntityType } from '../../../core/models/primary-intelligence.model';

/** One selectable anchor row for the compose dialog's entity select. */
export interface ComposeEntityRow {
  entity_type: IntelligenceEntityType;
  entity_id: string;
  label: string;
  sub_label: string;
}

interface TrialRow {
  id: string;
  name: string;
  identifier: string | null;
}

interface CompanyRow {
  id: string;
  name: string;
}

interface AssetRow {
  id: string;
  name: string;
  companies: { name: string } | { name: string }[] | null;
}

/**
 * Flattens the per-space trial / company / asset fetches into the flat
 * option list the compose dialog binds. Pure so the entity-type mapping and
 * the asset->company sub-label resolution (PostgREST embeds can arrive as an
 * object or a single-element array) are unit-testable without a live client.
 */
export function buildComposeEntityOptions(input: {
  trials: TrialRow[];
  companies: CompanyRow[];
  assets: AssetRow[];
}): ComposeEntityRow[] {
  const rows: ComposeEntityRow[] = [];

  for (const t of input.trials) {
    rows.push({
      entity_type: 'trial',
      entity_id: t.id,
      label: t.name,
      sub_label: t.identifier ?? '',
    });
  }

  for (const c of input.companies) {
    rows.push({ entity_type: 'company', entity_id: c.id, label: c.name, sub_label: '' });
  }

  for (const a of input.assets) {
    const company = Array.isArray(a.companies) ? a.companies[0] : a.companies;
    rows.push({
      entity_type: 'product',
      entity_id: a.id,
      label: a.name,
      sub_label: company?.name ?? '',
    });
  }

  return rows;
}
