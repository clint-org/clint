/**
 * Engagement materials registry models. Mirrors the Postgres tables
 * `materials` and `material_links` and the jsonb shapes returned by the
 * registry RPCs.
 */

export type MaterialType = 'briefing' | 'priority_notice' | 'ad_hoc';

export type MaterialEntityType =
  | 'trial'
  | 'marker'
  | 'company'
  | 'product'
  | 'space';

export interface MaterialLink {
  entity_type: MaterialEntityType;
  entity_id: string;
  display_order: number;
}

export interface Material {
  id: string;
  space_id: string;
  uploaded_by: string;
  file_path: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  material_type: MaterialType;
  title: string;
  uploaded_at: string;
  links: MaterialLink[];
}

export interface MaterialListResult {
  rows: Material[];
  total?: number;
  limit?: number;
  offset?: number;
}

export interface RegisterMaterialInput {
  space_id: string;
  file_path: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  material_type: MaterialType;
  title: string;
  links: MaterialLink[];
}

export interface UpdateMaterialInput {
  id: string;
  title?: string | null;
  material_type?: MaterialType | null;
  links?: MaterialLink[] | null;
}

export interface DownloadMaterialResult {
  material_id: string;
  space_id: string;
  file_path: string;
  file_name: string;
  mime_type: string;
}

export const MATERIAL_TYPE_LABEL: Record<MaterialType, string> = {
  briefing: 'Briefing',
  priority_notice: 'Priority notice',
  ad_hoc: 'Ad hoc',
};

export const MATERIAL_ENTITY_LABEL: Record<MaterialEntityType, string> = {
  trial: 'Trial',
  marker: 'Marker',
  company: 'Company',
  product: 'Product',
  space: 'Engagement',
};

/**
 * Mime-type to file-kind classification. PPTX amber, PDF red, DOCX blue
 * is the brand-mandated palette per docs/brand.md.
 */
export type MaterialFileKind = 'pptx' | 'pdf' | 'docx' | 'other';

export function classifyMaterialMime(mime: string, fileName?: string): MaterialFileKind {
  const m = (mime ?? '').toLowerCase();
  const f = (fileName ?? '').toLowerCase();
  if (
    m === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    m === 'application/vnd.ms-powerpoint' ||
    f.endsWith('.pptx') ||
    f.endsWith('.ppt')
  ) {
    return 'pptx';
  }
  if (m === 'application/pdf' || f.endsWith('.pdf')) return 'pdf';
  if (
    m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    m === 'application/msword' ||
    f.endsWith('.docx') ||
    f.endsWith('.doc')
  ) {
    return 'docx';
  }
  return 'other';
}

export const MATERIAL_DEFAULT_ALLOWED_MIME: readonly string[] = [
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
