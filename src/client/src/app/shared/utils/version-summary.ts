export type VersionSection = 'headline' | 'thesis' | 'watch' | 'implications';

export interface VersionShape {
  headline: string;
  thesis_md: string;
  watch_md: string;
  implications_md: string;
}

export interface VersionChangeSummary {
  changedSections: VersionSection[];
  isFirst: boolean;
}

const ORDER: { section: VersionSection; field: keyof VersionShape }[] = [
  { section: 'headline', field: 'headline' },
  { section: 'thesis', field: 'thesis_md' },
  { section: 'watch', field: 'watch_md' },
  { section: 'implications', field: 'implications_md' },
];

export function summarizeVersionChange(
  thisVersion: VersionShape,
  priorVersion: VersionShape | null
): VersionChangeSummary {
  if (priorVersion === null) {
    return { changedSections: [], isFirst: true };
  }
  const changedSections: VersionSection[] = [];
  for (const { section, field } of ORDER) {
    if (thisVersion[field] !== priorVersion[field]) {
      changedSections.push(section);
    }
  }
  return { changedSections, isFirst: false };
}
