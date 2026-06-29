/**
 * Unit tests for PiDetailSectionComponent.
 *
 * The unit-test runner is a plain node environment (vitest.units.config.ts)
 * without the Angular compiler, so we pin the template contract by source
 * assertion rather than mounting via TestBed. The contract this section owes
 * every host: an owned-PI block (mark + headline + summary), an optional
 * count line, and a focusable, keyboard-activatable reference list -- all
 * brand-tinted, never hardcoded teal.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ENTITY_TYPE_LABEL } from '../../../core/models/primary-intelligence.model';

const src = readFileSync(join(__dirname, 'pi-detail-section.component.ts'), 'utf8');

describe('PiDetailSection owned-PI block', () => {
  it('renders the brand-tinted PI block gated on a headline', () => {
    expect(src).toContain('@if (hasOwned())');
    expect(src).toContain('Intelligence');
    expect(src).toContain('{{ headline() }}');
    expect(src).toContain('{{ summary() }}');
    expect(src).toContain('<app-pi-mark');
  });

  it('uses brand utilities for the PI surface, never teal', () => {
    expect(src).toMatch(/bg-brand-50/);
    expect(src).toMatch(/text-brand-700/);
    expect(src).not.toMatch(/teal-/);
  });
});

describe('PiDetailSection reference list', () => {
  it('shows the optional count line and a row per reference', () => {
    expect(src).toContain('@if (countLabel())');
    expect(src).toContain('{{ countLabel() }}');
    expect(src).toContain('@for (ref of references()');
    expect(src).toContain('{{ ref.headline }}');
    expect(src).toContain('data-pi-reference');
  });

  it('makes reference rows focusable and keyboard-activatable', () => {
    expect(src).toContain('role="button"');
    expect(src).toContain('tabindex="0"');
    expect(src).toContain('(click)="referenceClick.emit(ref)"');
    expect(src).toContain('(keydown.enter)="referenceClick.emit(ref)"');
    expect(src).toContain('(keydown.space)="referenceClick.emit(ref)"');
  });

  it('labels each reference by entity type using the shared label map', () => {
    expect(src).toContain('label(ref.entity_type)');
    expect(src).toContain('ENTITY_TYPE_LABEL');
    // Sanity-check the map the component delegates to.
    expect(ENTITY_TYPE_LABEL.trial).toBe('Trial');
    expect(ENTITY_TYPE_LABEL.product).toBe('Asset');
    expect(ENTITY_TYPE_LABEL.event).toBe('Event');
  });
});
