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
  phase: z.enum(['phase_1', 'phase_2', 'phase_3', 'phase_4']).nullable().optional().default(null),
  phase_start_date: dateString.nullable().optional().default(null),
  phase_end_date: dateString.nullable().optional().default(null),
  status: z
    .enum(['Planned', 'Active', 'Completed', 'Terminated', 'Withdrawn'])
    .nullable()
    .optional()
    .default(null),
  sample_size: z.number().int().nullable().optional().default(null),
  sponsor_ref: z.number().int(),
  asset_ref: z.number().int().nullable().optional().default(null),
  indication: z.string().nullable().optional().default(null),
  evidence: z.string(),
});

const MarkerSchema = z.object({
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
  hash: string;
}

export interface ExtractRequest {
  space_id: string;
  source_kind: 'url' | 'text';
  source_url?: string;
  source_text?: string;
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
  source_kind: 'url' | 'text';
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
}
