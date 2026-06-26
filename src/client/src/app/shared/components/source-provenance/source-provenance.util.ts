import { SourceProvenance } from './source-provenance.model';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Title shown in the inline "IMPORTED FROM ..." line and the drawer header. */
export function provenanceTitle(doc: SourceProvenance | null): string {
  const title = doc?.source_title?.trim();
  return title ? title : 'Untitled source';
}

/** Human label for the source kind, used as a small badge. */
export function sourceKindLabel(kind: SourceProvenance['source_kind']): string {
  return kind === 'url' ? 'Web page' : 'Pasted text';
}

/** Short, locale-independent UTC date for the inline line (e.g. "Jun 3, 2026"). */
export function formatProvenanceDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
