import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('public footer template contract', () => {
  const src = readFileSync(join(__dirname, 'public-footer.component.ts'), 'utf8');

  it('shows the Clint mark beside the Powered by credit', () => {
    expect(src).toContain('app-clint-logo');
    expect(src).toContain('Powered by');
  });
});

describe('marketing landing mark', () => {
  const src = readFileSync(
    join(__dirname, '../../features/marketing/marketing-landing.component.ts'),
    'utf8'
  );

  it('sources the mark from shared geometry instead of hand-inlined points', () => {
    expect(src).toContain(`from '../../shared/components/clint-mark'`);
    expect(src).not.toContain('points="112,24 24,24 24,116 112,116"');
  });

  it('leads with a centered workspace finder (login-only landing)', () => {
    // The unauthenticated landing is a centered sign-in surface: positioning
    // copy plus the workspace finder, with no product render beside it. It must
    // not reintroduce the old two-column timeline-preview layout.
    expect(src).toContain('Find your workspace');
    expect(src).not.toContain('MarketingTimelinePreviewComponent');
  });
});
