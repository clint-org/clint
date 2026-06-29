import { describe, it, expect } from 'vitest';

import { paletteKindLabel } from './palette-result-row.component';

describe('paletteKindLabel', () => {
  it('renders a retired "catalyst" pin under the unified "Event" label', () => {
    expect(paletteKindLabel('catalyst')).toBe('Event');
  });

  it('labels a command row', () => {
    expect(paletteKindLabel('command')).toBe('Command');
  });

  it('capitalizes ordinary entity kinds', () => {
    expect(paletteKindLabel('event')).toBe('Event');
    expect(paletteKindLabel('trial')).toBe('Trial');
    expect(paletteKindLabel('company')).toBe('Company');
  });
});
