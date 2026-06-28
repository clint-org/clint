/**
 * Source-contract spec for IntelligenceComposeDialogComponent.
 *
 * The component itself cannot be instantiated in plain Vitest (it pulls in
 * Angular + PrimeNG which require the JIT compiler). The pure helper
 * buildComposeTarget is tested in compose-entity-options.spec.ts; this file
 * asserts the structural contract of the component source so that wiring
 * regressions are caught without a TestBed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildComposeTarget } from './compose-entity-options';

const componentSrc = readFileSync(
  join(__dirname, 'intelligence-compose-dialog.component.ts'),
  'utf8'
);

const helperSrc = readFileSync(join(__dirname, 'compose-entity-options.ts'), 'utf8');

describe('buildComposeTarget (unit)', () => {
  it('returns a ComposeTarget with anchorId null for a trial', () => {
    const target = buildComposeTarget('trial', 'trial-1');
    expect(target).toEqual({ entityType: 'trial', entityId: 'trial-1', anchorId: null });
  });

  it('always sets anchorId to null regardless of entity type', () => {
    expect(buildComposeTarget('company', 'co-1').anchorId).toBeNull();
    expect(buildComposeTarget('product', 'asset-1').anchorId).toBeNull();
    expect(buildComposeTarget('space', 'space-1').anchorId).toBeNull();
  });
});

describe('IntelligenceComposeDialogComponent source contract', () => {
  it('ComposeTarget interface declares anchorId as string | null', () => {
    // ComposeTarget is defined in the helper to stay free of Angular imports.
    expect(helperSrc).toContain('anchorId: string | null');
  });

  it('buildComposeTarget always emits anchorId null (new-anchor mode)', () => {
    expect(helperSrc).toContain('anchorId: null');
  });

  it('component delegates emit to buildComposeTarget from compose-entity-options', () => {
    expect(componentSrc).toContain('buildComposeTarget');
  });
});
