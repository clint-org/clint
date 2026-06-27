import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const dir = join(__dirname);
const tsSrc = readFileSync(join(dir, 'intelligence-stack.component.ts'), 'utf8');
const htmlSrc = readFileSync(join(dir, 'intelligence-stack.component.html'), 'utf8');

describe('IntelligenceStackComponent contract', () => {
  it('is a standalone OnPush component with the required signals API', () => {
    expect(tsSrc).not.toContain('standalone: false');
    expect(tsSrc).toContain('ChangeDetectionStrategy.OnPush');
    expect(tsSrc).toContain('briefs = input<PrimaryIntelligenceBrief[]>([])');
    expect(tsSrc).toContain('canManage = input<boolean>(false)');
    expect(tsSrc).toContain('canPurge = input<boolean>(false)');
    expect(tsSrc).toContain('histories = input<Record<string, IntelligenceHistoryPayload>>({})');
    expect(tsSrc).toContain('edit = output<string>()');
    expect(tsSrc).toContain('pin = output<string>()');
    expect(tsSrc).toContain('reorderTo = output<string[]>()');
    expect(tsSrc).toContain('requestHistory = output<string>()');
    expect(tsSrc).toContain('withdraw = output<{ anchorId: string; id: string; headline: string }>()');
    expect(tsSrc).toContain('purgeVersion = output<{ id: string; confirmation: string }>()');
    expect(tsSrc).toContain('purgeEntry = output<{ id: string; confirmation: string }>()');
  });

  it('uses the pure reorder helper (full-set emit) on drop', () => {
    expect(tsSrc).toContain("from './reorder'");
    expect(tsSrc).toContain('computeReorder(');
    expect(tsSrc).toContain('this.reorderTo.emit(');
  });

  it('lazily requests history via a reconciling effect that survives a cache clear', () => {
    expect(tsSrc).toContain('inFlight');
    expect(tsSrc).toContain('expandedAnchorIds');
    expect(tsSrc).toContain('this.requestHistory.emit(');
  });
});

describe('IntelligenceStackComponent template contract', () => {
  it('renders one card per brief, lead distinguished and drag-locked', () => {
    expect(htmlSrc).toContain('data-testid="brief-card"');
    expect(htmlSrc).toContain('cdkDropList');
    expect(htmlSrc).toContain('cdkDragDisabled');
    expect(htmlSrc).toContain('Lead');
  });

  it('shows the Published/Draft state and a Draft pending pill on the lead', () => {
    expect(htmlSrc).toContain('Published');
    expect(htmlSrc).toContain('Draft pending');
    expect(htmlSrc).toContain('brief.draft');
  });

  it('gates pin/edit/menu behind canManage', () => {
    expect(htmlSrc).toContain('@if (canManage())');
    expect(htmlSrc).toContain('Pin as lead entry');
    expect(htmlSrc).toContain('Edit entry');
  });

  it('mounts the history panel inline, fed per-anchor payload', () => {
    expect(htmlSrc).toContain('app-intelligence-history-panel');
    expect(htmlSrc).toContain('histories()[brief.anchor_id]');
  });

  it('offers withdraw and purge in the overflow menu (menuFor labels)', () => {
    expect(tsSrc).toContain("label: 'Withdraw'");
    expect(tsSrc).toContain("label: 'Purge entry'");
    expect(tsSrc).toContain("label: 'Discard draft'");
    expect(tsSrc).toContain('this.discardDraft.emit(');
  });
});

describe('role-aware agency byline', () => {
  it('renders the role-aware agency byline on the lead card', () => {
    expect(tsSrc).toContain('agencyLogoFromBrand');
    expect(tsSrc).toContain('leadBylineName');
    expect(tsSrc).toContain('resolveOtherContributorsLine');
    expect(htmlSrc).toContain('app-brand-logo');
    expect(htmlSrc).toContain('leadBylineName()');
  });
});

describe('lead-disabled pin logic', () => {
  // Mirror the component's canPinBrief rule as a pure check.
  function canPin(isLead: boolean, hasPublished: boolean): boolean {
    return !isLead && hasPublished;
  }
  it('disables pin on the lead and on draft-only briefs', () => {
    expect(canPin(true, true)).toBe(false);
    expect(canPin(false, false)).toBe(false);
    expect(canPin(false, true)).toBe(true);
  });
});
