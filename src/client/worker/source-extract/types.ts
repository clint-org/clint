import { z } from 'zod';

// ---------------------------------------------------------------------------
// Reusable fragments
// ---------------------------------------------------------------------------

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const existingMatch = z.object({
  kind: z.literal('existing'),
  id: z.string().uuid(),
});

const newCompanyMatch = z.object({
  kind: z.literal('new'),
  name: z.string(),
  website: z.string().nullable().optional(),
});

const newEntityMatch = z.object({
  kind: z.literal('new'),
  name: z.string(),
});

// Marker/event matches carry no name field -- the title is already on the object.
const newSimpleMatch = z.object({
  kind: z.literal('new'),
});

// ---------------------------------------------------------------------------
// Entity schemas
// ---------------------------------------------------------------------------

const CompanySchema = z.object({
  match: z.discriminatedUnion('kind', [existingMatch, newCompanyMatch]),
  evidence: z.string(),
});

const AssetSchema = z.object({
  match: z.discriminatedUnion('kind', [existingMatch, newEntityMatch]),
  name: z.string(),
  generic_name: z.string().nullable().optional().default(null),
  company_ref: z.number().int(),
  moa: z.array(z.string()).optional().default([]),
  roa: z.array(z.string()).optional().default([]),
  evidence: z.string(),
});

const TrialSchema = z.object({
  match: z.discriminatedUnion('kind', [existingMatch, newEntityMatch]),
  name: z.string(),
  phase: z
    .enum(['PRECLIN', 'P1', 'P1_2', 'P2', 'P2_3', 'P3', 'P4', 'OBS'])
    .nullable()
    .optional()
    .default(null),
  phase_start_date: dateString.nullable().optional().default(null),
  phase_end_date: dateString.nullable().optional().default(null),
  status: z
    .enum(['Planned', 'Active', 'Completed', 'Terminated', 'Withdrawn'])
    .nullable()
    .optional()
    .default(null),
  sample_size: z.number().int().nullable().optional().default(null),
  sponsor_ref: z.number().int(),
  // A trial can test multiple assets (e.g. a master-protocol NCT with separate
  // experimental arms). asset_refs holds every asset it tests (zero-based indices
  // into the assets array; empty for observational studies with no intervention).
  // primary_asset_ref is the headline asset and must be one of asset_refs.
  asset_refs: z.array(z.number().int()).optional().default([]),
  primary_asset_ref: z.number().int().nullable().optional().default(null),
  // A trial can study more than one indication. `indications` is the canonical
  // multi-value field; the scalar `indication` is kept for back-compat with
  // older proposals and is folded into `indications` downstream.
  indications: z.array(z.string()).optional().default([]),
  indication: z.string().nullable().optional().default(null),
  evidence: z.string(),
});

const MarkerSchema = z.object({
  match: z
    .discriminatedUnion('kind', [existingMatch, newSimpleMatch])
    .default({ kind: 'new' }),
  marker_type: z.string(),
  title: z.string(),
  event_date: dateString.nullable().optional().default(null),
  end_date: dateString.nullable().optional().default(null),
  projection: z.enum(['actual', 'company', 'primary']).optional().default('company'),
  description: z.string().nullable().optional().default(null),
  trial_refs: z.array(z.number().int()).optional().default([]),
  evidence: z.string(),
});

const EventSchema = z.object({
  match: z
    .discriminatedUnion('kind', [existingMatch, newSimpleMatch])
    .default({ kind: 'new' }),
  category: z.string(),
  title: z.string(),
  event_date: dateString.nullable().optional().default(null),
  description: z.string().nullable().optional().default(null),
  priority: z.enum(['high', 'low']).optional().default('low'),
  tags: z.array(z.string()).optional().default([]),
  anchor: z.object({
    level: z.enum(['space', 'company', 'asset', 'trial']),
    ref: z.number().int().nullable().optional().default(null),
  }),
  evidence: z.string(),
});

// ---------------------------------------------------------------------------
// LLM output schema
// ---------------------------------------------------------------------------

export const ExtractionResultSchema = z.object({
  source_summary: z.string(),
  source_title: z.string().nullable().optional().default(null),
  source_date: dateString.nullable().optional().default(null),
  companies: z.array(CompanySchema).optional().default([]),
  assets: z.array(AssetSchema).optional().default([]),
  trials: z.array(TrialSchema).optional().default([]),
  markers: z.array(MarkerSchema).optional().default([]),
  events: z.array(EventSchema).optional().default([]),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

// ---------------------------------------------------------------------------
// Plain TypeScript types
// ---------------------------------------------------------------------------

export interface InventorySnapshot {
  companies: { id: string; name: string }[];
  assets: {
    id: string;
    name: string;
    company_id: string;
    generic_name?: string;
  }[];
  trials: {
    id: string;
    name: string;
    identifier?: string;
    asset_id: string;
    phase_type?: string;
  }[];
  indications: { id: string; name: string }[];
  marker_types: { id: string; name: string }[];
  event_categories: { id: string; name: string }[];
  mechanisms_of_action: { id: string; name: string }[];
  routes_of_administration: { id: string; name: string; abbreviation?: string }[];
  /** Existing marker instances in the space, one entry per (marker, trial) pair.
   *  Used by the import validator to detect duplicate markers across re-imports. */
  markers?: {
    id: string;
    trial_id: string;
    marker_type: string;
    title: string;
    event_date: string | null;
  }[];
  /** Existing event instances in the space with their anchor.
   *  Used by the import validator to detect duplicate events across re-imports. */
  events?: {
    id: string;
    anchor: {
      level: 'space' | 'company' | 'asset' | 'trial';
      id: string | null;
    };
    category: string;
    title: string;
    event_date: string | null;
  }[];
  hash: string;
}

export interface ExtractRequest {
  space_id: string;
  source_kind: 'url' | 'text';
  source_url?: string;
  source_text?: string;
}

export interface NctResolveRequest {
  space_id: string;
  nct_ids: string[];
}

export interface DroppedEntity {
  type: 'company' | 'asset' | 'trial' | 'marker' | 'event';
  index: number;
  name: string;
  reason: string;
}

export interface FuzzyAlternate {
  id: string;
  name: string;
  score: number;
}

export interface CtgovCandidate {
  nct_id: string;
  brief_title: string;
  score: number;
  status: string;
  phase: string;
}

export interface ExtractResponse {
  ai_call_id: string;
  source_kind: 'url' | 'text' | 'nct';
  source_url: string | null;
  source_text: string;
  source_text_hash: string;
  source_title: string | null;
  source_date: string | null;
  source_summary: string;
  proposals: ExtractionResult;
  dropped: DroppedEntity[];
  fuzzy_alternates: Record<string, FuzzyAlternate[]>;
  ctgov_candidates: Record<string, CtgovCandidate[]>;
  inventory_snapshot_hash: string;
  warnings: string[];
  /** Maps "companies_0", "assets_1", etc. to display names resolved from inventory. */
  resolved_names: Record<string, string>;
  /** Maps "trials_0", etc. to external identifiers (NCT IDs) resolved from inventory for existing matches. */
  resolved_identifiers: Record<string, string>;
}
