/**
 * Engagement materials registry models. Mirrors the Postgres tables
 * `materials` and `material_links` and the jsonb shapes returned by the
 * registry RPCs.
 */

export type MaterialType = 'briefing' | 'conference_report' | 'priority_notice' | 'ad_hoc';

export type MaterialEntityType = 'trial' | 'marker' | 'company' | 'product' | 'space' | 'event';

export interface MaterialLink {
  entity_type: MaterialEntityType;
  entity_id: string;
  display_order: number;
  /**
   * Display name of the linked entity, resolved server-side by the list RPCs
   * (trial acronym/name, marker title, company/asset/space name). Optional
   * because it is read-only output: the register/update inputs do not send it.
   * Null when the linked entity has been deleted.
   */
  entity_name?: string | null;
  /**
   * Parent trial id for a marker link, resolved server-side by the list RPCs
   * (the marker's first trial assignment). Lets the UI deep-link a marker chip
   * to the trial timeline, since markers have no standalone page. Null/absent
   * for non-marker links and for a marker with no trial assignment. Read-only
   * output: the register/update inputs do not send it.
   */
  trial_id?: string | null;
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
  /**
   * True for intentionally-fileless seed/demo/playground materials with no
   * backing R2 object. The UI skips the download (which would 404) and shows
   * an informational message instead.
   */
  is_sample: boolean;
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
  conference_report: 'Conference report',
  priority_notice: 'Priority notice',
  ad_hoc: 'Ad hoc',
};

export const MATERIAL_ENTITY_LABEL: Record<MaterialEntityType, string> = {
  trial: 'Trial',
  marker: 'Marker',
  company: 'Company',
  product: 'Asset',
  space: 'Space',
  event: 'Event',
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

/**
 * Short uppercase label shown inside the file-type tile (e.g. "PDF", "PPTX").
 * Prefers the real filename extension when it is short and alphanumeric, so a
 * `.doc` reads "DOC" rather than the kind's canonical "DOCX"; falls back to the
 * file-kind label when the name carries no usable extension.
 */
export function materialExtLabel(fileName: string, kind: MaterialFileKind): string {
  const name = fileName ?? '';
  const dot = name.lastIndexOf('.');
  if (dot >= 0 && dot < name.length - 1) {
    const ext = name.slice(dot + 1).toUpperCase();
    if (ext.length <= 4 && /^[A-Z0-9]+$/.test(ext)) return ext;
  }
  switch (kind) {
    case 'pptx':
      return 'PPTX';
    case 'pdf':
      return 'PDF';
    case 'docx':
      return 'DOCX';
    default:
      return 'FILE';
  }
}

export const MATERIAL_DEFAULT_ALLOWED_MIME: readonly string[] = [
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
