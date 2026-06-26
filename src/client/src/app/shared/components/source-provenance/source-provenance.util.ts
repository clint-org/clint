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
  switch (kind) {
    case 'url':
      return 'Web page';
    case 'nct':
      return 'NCT batch';
    default:
      return 'Pasted text';
  }
}

/**
 * Heading for the raw-source block. Kind-aware because the stored body is not
 * always text the analyst authored: an NCT import stores the CT.gov study
 * record (the model's input), and a URL import stores the fetched page.
 */
export function sourceBodyLabel(kind: SourceProvenance['source_kind']): string {
  switch (kind) {
    case 'url':
      return 'Fetched page';
    case 'nct':
      return 'Retrieved study data';
    default:
      return 'Original text';
  }
}

/** Short, locale-independent UTC date for the inline line (e.g. "Jun 3, 2026"). */
export function formatProvenanceDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
