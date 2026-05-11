import { test, expect } from '@playwright/test';
import { IntelligenceHistoryEvent } from '../../../core/models/primary-intelligence.model';
import { foldArchivedEvents } from './history-timeline';

function ev(
  kind: IntelligenceHistoryEvent['kind'],
  at: string,
  row_id: string,
  version_number: number | null = null,
): IntelligenceHistoryEvent {
  return { at, kind, row_id, version_number, by: 'user-1', note: null };
}

test.describe('foldArchivedEvents', () => {
  test('empty input yields empty output', () => {
    expect(foldArchivedEvents([])).toEqual([]);
  });

  test('passes through non-archive events as top-level rows', () => {
    const events = [
      ev('draft_started', '10:00', 'D1'),
      ev('published', '10:15', 'D1', 1),
      ev('withdrawn', '11:00', 'D1', 1),
    ];
    const result = foldArchivedEvents(events);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.event.kind)).toEqual(['draft_started', 'published', 'withdrawn']);
    expect(result.every((r) => r.archivedChildren.length === 0)).toBe(true);
  });

  test('folds archive under publish at the same timestamp', () => {
    const events = [
      ev('draft_started', '10:00', 'D1'),
      ev('published', '10:15', 'D1', 1),
      ev('draft_started', '11:00', 'D2'),
      ev('published', '11:30', 'D2', 2),
      ev('archived', '11:30', 'D1', 1),
    ];
    const result = foldArchivedEvents(events);
    expect(result).toHaveLength(4);
    const v2Publish = result.find((r) => r.event.row_id === 'D2' && r.event.kind === 'published');
    expect(v2Publish?.archivedChildren).toHaveLength(1);
    expect(v2Publish?.archivedChildren[0].row_id).toBe('D1');
    expect(v2Publish?.archivedChildren[0].kind).toBe('archived');
  });

  test('drops orphan archive events with no matching publish', () => {
    const events = [
      ev('published', '10:15', 'D1', 1),
      ev('archived', '20:00', 'D1', 1),
    ];
    const result = foldArchivedEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].event.kind).toBe('published');
    expect(result[0].archivedChildren).toHaveLength(0);
  });

  test('folds multiple archives at the same publish timestamp', () => {
    const events = [
      ev('published', '12:00', 'D3', 3),
      ev('archived', '12:00', 'D1', 1),
      ev('archived', '12:00', 'D2', 2),
    ];
    const result = foldArchivedEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].archivedChildren).toHaveLength(2);
    expect(result[0].archivedChildren.map((c) => c.row_id).sort()).toEqual(['D1', 'D2']);
  });

  test('does not attach archived children to withdrawn rows', () => {
    const events = [
      ev('withdrawn', '12:00', 'D2', 2),
      ev('archived', '12:00', 'D1', 1),
    ];
    const result = foldArchivedEvents(events);
    const withdrawnRow = result.find((r) => r.event.kind === 'withdrawn');
    expect(withdrawnRow?.archivedChildren).toEqual([]);
  });
});
