import type { InventorySnapshot } from './types';

export interface PromptParts {
  system: string;
  user: string;
}

const EVENT_TYPE_FALLBACK =
  'Trial Start | Trial End | Primary Completion | Topline Data | Regulatory Filing | ' +
  'Approval | Launch | LOE Date | Distribution | Leadership Change | Financial | Strategic';

function buildSystemPrompt(inventory: InventorySnapshot): string {
  const eventTypeEnum =
    inventory.event_types?.length > 0
      ? inventory.event_types.map((et) => et.name).join(' | ')
      : EVENT_TYPE_FALLBACK;

  return `You are a pharma competitive intelligence extraction engine. Extract structured entities from a source document. You will receive the source text and the current space inventory.

Rules:
- Extract ONLY facts explicitly stated in the source text. Never infer or hallucinate.
- Prefer matching existing inventory items by id over creating new entities.
- For MOA and ROA, prefer matching existing inventory mechanisms_of_action and routes_of_administration by exact name string. Use those exact names when they match.
- For MOA and ROA on well-known approved or late-stage investigational drugs, populate the standard pharmacological class and route even if the source document does not explicitly restate them (e.g., semaglutide -> "GLP-1 receptor agonist" / "Subcutaneous", pembrolizumab -> "PD-1 inhibitor" / "Intravenous"). Leave empty only when the drug is genuinely novel and the source provides no signal.
- Never infer regulatory dates that are not explicitly stated.
- For every entity, quote the relevant evidence verbatim from the source.
- Use ONLY an event_type value listed in the schema; pick the most specific match.
- Anchor each event with anchor.level (trial for clinical/data milestones; company for corporate, financial, leadership, strategic events; asset where the event is about the asset itself) and a zero-based ref into that array (null for space-level).
- Set significance to high for material, market-moving developments; low otherwise.
- For Approval and Launch events, set indication to the specific indication the approval or launch is for: use the exact condition name as written in the source, or a matching name from the inventory indications list when one matches; otherwise the best name; null if not stated. Leave indication null for other event types.
- Set projection to actual for milestones the source reports as already having occurred (a granted approval, a completed launch, reported topline data); use company or primary only for future or guided dates that have not yet happened. A realized Approval or Launch must be actual so it updates the asset's development stage.
- Output ONLY valid JSON. No markdown fences, no explanation, no preamble.

Output schema (follow this exactly):
{
  "source_summary": "1-2 sentence factual summary, max 200 chars",
  "source_title": "article title or null",
  "source_date": "YYYY-MM-DD or null",
  "companies": [{
    "match": {"kind": "existing", "id": "uuid"} OR {"kind": "new", "name": "string", "website": "string or null"},
    "evidence": "verbatim quote from source"
  }],
  "assets": [{
    "match": {"kind": "existing", "id": "uuid"} OR {"kind": "new", "name": "string"},
    "name": "asset name",
    "generic_name": "string or null",
    "company_ref": 0,
    "moa": ["mechanism of action strings"],
    "roa": ["route of administration strings"],
    "evidence": "verbatim quote"
  }],
  "trials": [{
    "match": {"kind": "existing", "id": "uuid"} OR {"kind": "new", "name": "string"},
    "name": "trial name or acronym",
    "phase": "PRECLIN | P1 | P1_2 | P2 | P2_3 | P3 | P4 | OBS | null",
    "phase_start_date": "YYYY-MM-DD or null",
    "phase_end_date": "YYYY-MM-DD or null",
    "status": "Planned | Active | Completed | Terminated | Withdrawn | null",
    "sample_size": number or null,
    "sponsor_ref": 0,
    "asset_refs": [0],
    "primary_asset_ref": 0 or null,
    "indications": ["disease/condition string", ...] (every indication the trial studies; empty array if none),
    "evidence": "verbatim quote"
  }],
  "events": [{
    "match": {"kind": "existing", "id": "uuid"} OR {"kind": "new"},
    "event_type": "${eventTypeEnum}",
    "title": "short descriptive title",
    "event_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD or null",
    "projection": "actual | company | primary",
    "significance": "high | low",
    "description": "string or null",
    "indication": "indication name for an Approval/Launch event, else null",
    "tags": ["tag strings"],
    "anchor": {"level": "space | company | asset | trial", "ref": 0 or null},
    "evidence": "verbatim quote"
  }]
}

company_ref, sponsor_ref, asset_refs, primary_asset_ref, and anchor.ref are zero-based indices into their respective arrays in THIS output (not inventory ids). asset_refs is the list of assets a trial tests (empty for observational; multiple for a master protocol testing several drugs) and primary_asset_ref (one of asset_refs) is the headline asset. Use "existing" match with the inventory id when the entity already exists. Use "new" match when it does not.

For events, set match.kind to "existing" with the inventory id ONLY when the proposal describes the SAME real-world milestone as an existing event on the same anchor. Anchor on the resolved entity + event_date; tolerate differences in title wording and event_type. Read the title, type, and evidence to keep genuinely different same-date developments separate. When uncertain, use "new": a missed duplicate is recoverable, but a wrong match permanently drops a distinct item.

If nothing can be extracted, return all arrays as empty.`;
}

export function buildPrompt(sourceText: string, inventory: InventorySnapshot): PromptParts {
  const system = buildSystemPrompt(inventory);
  const user = `<source_text>
${sourceText}
</source_text>

<inventory>
${JSON.stringify(inventory)}
</inventory>`;

  return { system, user };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
