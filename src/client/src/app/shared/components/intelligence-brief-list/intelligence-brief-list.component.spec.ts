/**
 * Test suite for IntelligenceBriefListComponent.
 *
 * Two layers:
 * 1. Source-contract tests: assert the .ts and .html source files have the
 *    required structure (inputs, outputs, aria attributes, canManage gating,
 *    vN chip). These run in the node vitest environment without Angular TestBed.
 * 2. Pure-logic tests: verify the toggle and reorder helper logic that
 *    underpins the component's interactive behaviour.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { signal } from '@angular/core';
import { describe, expect, it } from 'vitest';

const tsSrc = readFileSync(
  join(__dirname, 'intelligence-brief-list.component.ts'),
  'utf8'
);
const htmlSrc = readFileSync(
  join(__dirname, 'intelligence-brief-list.component.html'),
  'utf8'
);

// ---------------------------------------------------------------------------
// Source-contract: component shape
// ---------------------------------------------------------------------------

describe('IntelligenceBriefListComponent contract', () => {
  it('is a standalone OnPush component with the required signals API', () => {
    // Standalone is the v20+ default; never set `standalone: true` explicitly.
    expect(tsSrc).not.toContain('standalone: false');
    expect(tsSrc).toContain('ChangeDetectionStrategy.OnPush');
    expect(tsSrc).toContain("briefs = input<PrimaryIntelligenceBrief[]>([])");
    expect(tsSrc).toContain("canManage = input<boolean>(false)");
    expect(tsSrc).toContain("authorMap = input<Record<string, string>>({})");
    expect(tsSrc).toContain("tenantId = input<string | null>(null)");
    expect(tsSrc).toContain("spaceId = input<string | null>(null)");
    expect(tsSrc).toContain("open = output<string>()");
    expect(tsSrc).toContain("pin = output<string>()");
    expect(tsSrc).toContain("reorderTo = output<string[]>()");
    expect(tsSrc).toContain("viewHistory = output<string>()");
  });

  it('declares expandedIds as a signal and toggleExpand as a method', () => {
    expect(tsSrc).toContain('expandedIds');
    expect(tsSrc).toContain('signal<');
    expect(tsSrc).toContain('toggleExpand(');
  });

  it('declares onViewHistoryClick that emits viewHistory with the anchor_id', () => {
    expect(tsSrc).toContain('onViewHistoryClick(anchorId: string)');
    expect(tsSrc).toContain('this.viewHistory.emit(anchorId)');
  });

  it('uses CDK drag-drop for reorder', () => {
    expect(tsSrc).toContain('CdkDrag');
    expect(tsSrc).toContain('CdkDropList');
    expect(tsSrc).toContain('moveItemInArray');
    expect(tsSrc).toContain('onDrop(');
  });
});

// ---------------------------------------------------------------------------
// Source-contract: template structure
// ---------------------------------------------------------------------------

describe('IntelligenceBriefListComponent template contract', () => {
  it('renders one row per brief with a data-testid="brief-row" attribute', () => {
    expect(htmlSrc).toContain('data-testid="brief-row"');
    expect(htmlSrc).toContain('headlineFor(brief)');
  });

  it('has an expand toggle button with aria-expanded and toggleExpand', () => {
    expect(htmlSrc).toContain('aria-expanded');
    expect(htmlSrc).toContain('toggleExpand(brief.anchor_id)');
  });

  it('shows expanded body content keyed by isExpanded', () => {
    expect(htmlSrc).toContain('isExpanded(brief.anchor_id)');
    expect(htmlSrc).toContain('summaryHtmlFor(brief)');
  });

  it('gates all manage affordances behind @if (canManage())', () => {
    expect(htmlSrc).toContain('@if (canManage())');
    expect(htmlSrc).toContain('onPinClick(brief.anchor_id)');
  });

  it('shows vN chip when version_count > 1', () => {
    expect(htmlSrc).toContain('version_count > 1');
    expect(htmlSrc).toContain('v{{ brief.version_count }}');
  });

  it('uses brand utilities rather than teal or indigo', () => {
    expect(htmlSrc).not.toMatch(/\bteal-/);
    expect(htmlSrc).not.toMatch(/\bindigo-/);
  });

  it('renders a Version history button in the expanded body that calls onViewHistoryClick', () => {
    expect(htmlSrc).toContain('Version history');
    expect(htmlSrc).toContain('onViewHistoryClick(brief.anchor_id)');
    expect(htmlSrc).toContain('aria-label="View version history for this entry"');
  });

  it('includes a pTooltip on the pin icon-only button', () => {
    expect(htmlSrc).toContain('pTooltip');
    expect(htmlSrc).toContain('Pin as lead entry');
  });

  it('includes CDK drag-drop directives on the list and each row', () => {
    expect(htmlSrc).toContain('cdkDropList');
    expect(htmlSrc).toContain('cdkDrag');
    expect(htmlSrc).toContain('cdkDragHandle');
    expect(htmlSrc).toContain('onDrop($event)');
  });
});

// ---------------------------------------------------------------------------
// Pure logic: expand / collapse toggle
// ---------------------------------------------------------------------------

describe('toggleExpand pure logic', () => {
  /**
   * Local mirror of the toggle logic used by the component.
   * Tested in isolation so the node environment never needs Angular DI.
   */
  function toggle(current: ReadonlySet<string>, id: string): ReadonlySet<string> {
    const next = new Set(current);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    return next;
  }

  it('adds an anchor_id when not present (collapsed -> expanded)', () => {
    const result = toggle(new Set(), 'a1');
    expect(result.has('a1')).toBe(true);
  });

  it('removes an anchor_id when already present (expanded -> collapsed)', () => {
    const result = toggle(new Set(['a1']), 'a1');
    expect(result.has('a1')).toBe(false);
  });

  it('leaves other anchor_ids unchanged when toggling one', () => {
    const result = toggle(new Set(['a1', 'a2']), 'a1');
    expect(result.has('a1')).toBe(false);
    expect(result.has('a2')).toBe(true);
  });

  it('does not mutate the input set', () => {
    const original = new Set(['a1']);
    toggle(original, 'a1');
    expect(original.has('a1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pure logic: reorder (mirrors onDrop handler)
// ---------------------------------------------------------------------------

describe('reorderBriefIds pure logic', () => {
  function reorder(ids: string[], prevIdx: number, currIdx: number): string[] {
    const items = [...ids];
    const [removed] = items.splice(prevIdx, 1);
    items.splice(currIdx, 0, removed);
    return items;
  }

  it('moves an item forward (first to last)', () => {
    expect(reorder(['a1', 'a2', 'a3'], 0, 2)).toEqual(['a2', 'a3', 'a1']);
  });

  it('moves an item backward (last to first)', () => {
    expect(reorder(['a1', 'a2', 'a3'], 2, 0)).toEqual(['a3', 'a1', 'a2']);
  });

  it('is a no-op when prevIdx equals currIdx', () => {
    expect(reorder(['a1', 'a2', 'a3'], 1, 1)).toEqual(['a1', 'a2', 'a3']);
  });

  it('does not mutate the input array', () => {
    const input = ['a1', 'a2', 'a3'];
    reorder(input, 0, 2);
    expect(input).toEqual(['a1', 'a2', 'a3']);
  });

  it('emits the correct anchor_id order after reorder', () => {
    const result = reorder(['a1', 'a2', 'a3'], 0, 1);
    expect(result).toEqual(['a2', 'a1', 'a3']);
  });
});

// ---------------------------------------------------------------------------
// Pure logic: expandedIds reactive signal
// ---------------------------------------------------------------------------

describe('expandedIds signal tracking', () => {
  it('tracks expanded state per anchor_id reactively', () => {
    const expandedIds = signal<ReadonlySet<string>>(new Set());

    expandedIds.update((s) => {
      const n = new Set(s);
      n.add('a1');
      return n;
    });
    expect(expandedIds().has('a1')).toBe(true);

    expandedIds.update((s) => {
      const n = new Set(s);
      n.delete('a1');
      return n;
    });
    expect(expandedIds().has('a1')).toBe(false);
  });

  it('can expand multiple entries independently', () => {
    const expandedIds = signal<ReadonlySet<string>>(new Set());

    expandedIds.update((s) => {
      const n = new Set(s);
      n.add('a1');
      n.add('a2');
      return n;
    });
    expect(expandedIds().has('a1')).toBe(true);
    expect(expandedIds().has('a2')).toBe(true);

    expandedIds.update((s) => {
      const n = new Set(s);
      n.delete('a1');
      return n;
    });
    expect(expandedIds().has('a1')).toBe(false);
    expect(expandedIds().has('a2')).toBe(true);
  });
});
