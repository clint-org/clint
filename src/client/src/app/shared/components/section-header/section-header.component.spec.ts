import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('section-header component contract', () => {
  const src = readFileSync(join(__dirname, 'section-header.component.ts'), 'utf8');

  it('keeps the list shape: label + detail string inputs and an actions slot', () => {
    expect(src).toContain('{{ label() }}');
    expect(src).toContain('ng-content select="[actions]"');
    expect(src).toContain("readonly label = input");
  });

  it('adds a variant input defaulting to list', () => {
    expect(src).toContain("readonly variant = input<'list' | 'detail'>('list')");
  });

  it('detail variant projects an eyebrow slot and a title slot', () => {
    expect(src).toContain('ng-content select="[eyebrow]"');
    expect(src).toContain('ng-content select="[title]"');
  });

  it("switches layout on variant === 'detail'", () => {
    expect(src).toContain("variant() === 'detail'");
  });
});
