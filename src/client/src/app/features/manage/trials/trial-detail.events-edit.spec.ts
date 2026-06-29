import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * QA-004: the event EDIT action must open the merged Event dialog
 * (EventFormDialogComponent) in edit mode so the re-anchor / re-type capability
 * is reachable, instead of the retired legacy inline marker form. The events
 * table + dialog now live in the shared EntityEventsSectionComponent, which the
 * trial / company / asset detail pages all mount -- so these source-text
 * assertions target the shared component (the trial page just wires it in).
 * Source-text (not TestBed) because the component needs the Playwright unit
 * config to mount.
 */
describe('entity events section: event edit opens the merged Event dialog', () => {
  const sectionDir = join(
    __dirname,
    '../../../shared/components/entity-events-section'
  );
  const sectionTs = readFileSync(join(sectionDir, 'entity-events-section.component.ts'), 'utf8');
  const sectionHtml = readFileSync(join(sectionDir, 'entity-events-section.component.html'), 'utf8');
  const trialTs = readFileSync(join(__dirname, 'trial-detail.component.ts'), 'utf8');
  const trialHtml = readFileSync(join(__dirname, 'trial-detail.component.html'), 'utf8');

  it('trial detail mounts the shared events section instead of the legacy marker form', () => {
    expect(trialTs).not.toContain('MarkerFormComponent');
    expect(trialHtml).not.toContain('app-marker-form');
    expect(trialHtml).not.toContain('Add marker');
    expect(trialHtml).toContain('<app-entity-events-section');
    expect(trialHtml).toContain('anchorType="trial"');
  });

  it('drives the merged dialog mode from the edit target', () => {
    expect(sectionTs).toContain('editingEventId');
    expect(sectionTs).toContain("eventDialogMode = computed<'create' | 'edit'>");
    expect(sectionHtml).toContain('[mode]="eventDialogMode()"');
    expect(sectionHtml).toContain('[eventId]="editingEventId()"');
  });

  it('the row Edit action sets the edit target and opens the dialog', () => {
    expect(sectionTs).toContain('this.editingEventId.set(marker.id)');
    expect(sectionTs).not.toContain('this.editingMarker.set');
    expect(sectionTs).not.toContain('this.addingMarker.set');
  });

  it('the ?marker= deep link opens the merged dialog in edit mode', () => {
    expect(sectionTs).toContain('this.editingEventId.set(markerId)');
  });

  it('locks ct.gov-owned events in the merged form', () => {
    expect(sectionTs).toContain('editingEventCtgovLocked');
    expect(sectionHtml).toContain('[ctgovLocked]="editingEventCtgovLocked()"');
  });

  it('guards the edit/delete affordances behind canEdit', () => {
    expect(sectionHtml).toContain('spaceRole.canEdit()');
    expect(sectionTs).toContain('canEdit: this.spaceRole.canEdit()');
  });
});
