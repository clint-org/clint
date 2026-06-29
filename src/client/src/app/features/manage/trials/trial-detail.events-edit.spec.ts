import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * QA-004: the marker/event EDIT action on trial-detail must open the merged
 * Event dialog (EventFormDialogComponent) in edit mode so the Part B re-anchor /
 * re-type capability is reachable, instead of the retired legacy inline marker
 * form. These are source-text assertions because the component needs Angular
 * TestBed (Playwright unit config) to mount.
 */
describe('trial detail: event edit opens the merged Event dialog', () => {
  const ts = readFileSync(join(__dirname, 'trial-detail.component.ts'), 'utf8');
  const html = readFileSync(join(__dirname, 'trial-detail.component.html'), 'utf8');

  it('no longer imports or renders the legacy marker form', () => {
    expect(ts).not.toContain('MarkerFormComponent');
    expect(html).not.toContain('app-marker-form');
    expect(html).not.toContain('Add marker');
  });

  it('drives the merged dialog mode from the edit target', () => {
    expect(ts).toContain('editingEventId');
    expect(ts).toContain("eventDialogMode = computed<'create' | 'edit'>");
    expect(html).toContain('[mode]="eventDialogMode()"');
    expect(html).toContain('[eventId]="editingEventId()"');
  });

  it('the row Edit action sets the edit target and opens the dialog', () => {
    // The markerMenu onEdit handler should target the event id, not the legacy
    // inline editor signals.
    expect(ts).toContain('this.editingEventId.set(marker.id)');
    expect(ts).not.toContain('this.editingMarker.set');
    expect(ts).not.toContain('this.addingMarker.set');
  });

  it('the ?marker= deep link opens the merged dialog in edit mode', () => {
    expect(ts).toContain('this.editingEventId.set(markerId)');
  });

  it('locks ct.gov-owned events in the merged form', () => {
    expect(ts).toContain('editingEventCtgovLocked');
    expect(html).toContain('[ctgovLocked]="editingEventCtgovLocked()"');
  });

  it('guards the edit/delete affordances behind canEdit', () => {
    expect(html).toContain('spaceRole.canEdit()');
    expect(ts).toContain('canEdit: this.spaceRole.canEdit()');
  });
});
