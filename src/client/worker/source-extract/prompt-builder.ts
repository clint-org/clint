import type { InventorySnapshot } from './types';

export interface PromptParts {
  system: string;
  user: string;
}

const SYSTEM_PROMPT = `You are a pharma competitive intelligence extraction engine. Your task is to extract structured data from a source article about pharmaceutical pipelines, clinical trials, and regulatory events.

Rules:
- Extract ONLY facts explicitly stated in the source text. Never infer or hallucinate.
- When an entity (company, asset, trial, indication) matches an existing inventory item, use the existing id. Only create new entities when no match exists.
- Never infer regulatory dates that are not explicitly stated in the text.
- For every extracted fact, include a verbatim quote from the source text as evidence.
- Output strict JSON matching the schema below. No markdown, no explanation, no wrapper.

Output JSON schema:
{
  "companies": [{ "id": "existing id or null for new", "name": "string" }],
  "assets": [{ "id": "existing id or null for new", "name": "string", "company_id": "string", "generic_name": "string or null" }],
  "trials": [{ "id": "existing id or null for new", "name": "string", "identifier": "NCT number or null", "asset_id": "string", "phase_type": "string or null" }],
  "indications": [{ "id": "existing id or null for new", "name": "string" }],
  "trial_indications": [{ "trial_id": "string", "indication_id": "string" }],
  "catalysts": [{ "trial_id": "string", "type": "string", "date": "YYYY-MM-DD or null", "description": "string", "evidence_quote": "verbatim quote from source" }],
  "regulatory_events": [{ "asset_id": "string", "type": "string", "date": "YYYY-MM-DD or null", "agency": "string or null", "description": "string", "evidence_quote": "verbatim quote from source" }]
}

If nothing can be extracted, return: { "companies": [], "assets": [], "trials": [], "indications": [], "trial_indications": [], "catalysts": [], "regulatory_events": [] }`;

export function buildPrompt(
  sourceText: string,
  inventory: InventorySnapshot,
): PromptParts {
  const user = `<source_text>
${sourceText}
</source_text>

<inventory>
${JSON.stringify(inventory)}
</inventory>`;

  return { system: SYSTEM_PROMPT, user };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
