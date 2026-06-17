import { describe, expect, it } from 'vitest';
import { buildExportFilename, buildExportStem } from './export-filename';

const DATE = new Date('2026-06-15T09:30:00Z');

describe('buildExportFilename (P1.1 / UI-21)', () => {
  it('stamps space, view, and UTC date', () => {
    expect(buildExportFilename({ space: 'Cardio Engagement', view: 'timeline', ext: 'png', date: DATE })).toBe(
      'cardio-engagement-timeline-2026-06-15.png',
    );
  });

  it('omits the space segment when no space name is given', () => {
    expect(buildExportFilename({ space: null, view: 'bullseye', ext: 'pptx', date: DATE })).toBe(
      'bullseye-2026-06-15.pptx',
    );
    expect(buildExportFilename({ space: '', view: 'heatmap', ext: 'xlsx', date: DATE })).toBe(
      'heatmap-2026-06-15.xlsx',
    );
  });

  it('slugifies punctuation and collapses separators', () => {
    expect(
      buildExportFilename({ space: 'Stout & Co. — Q3!', view: 'timeline', ext: 'png', date: DATE }),
    ).toBe('stout-co-q3-timeline-2026-06-15.png');
  });

  it('still yields a valid name when the view slugifies away (date carries it)', () => {
    expect(buildExportFilename({ space: '', view: '!!!', ext: 'png', date: DATE })).toBe(
      '2026-06-15.png',
    );
  });
});

describe('buildExportStem (extension-less, for sheet-excel)', () => {
  it('omits the extension', () => {
    expect(buildExportStem({ space: 'Cardio Engagement', view: 'bullseye', date: DATE })).toBe(
      'cardio-engagement-bullseye-2026-06-15',
    );
  });

  it('drops the space segment when absent', () => {
    expect(buildExportStem({ space: '', view: 'heatmap', date: DATE })).toBe('heatmap-2026-06-15');
  });
});
