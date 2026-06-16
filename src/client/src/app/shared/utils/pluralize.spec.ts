import { describe, expect, it } from 'vitest';
import { pluralize } from './pluralize';

describe('pluralize (UI-24)', () => {
  it('uses the singular for exactly 1', () => {
    expect(pluralize(1, 'P3 readout')).toBe('P3 readout');
    expect(pluralize(1, 'Trial move')).toBe('Trial move');
  });

  it('uses the plural for counts other than 1', () => {
    expect(pluralize(0, 'P3 readout')).toBe('P3 readouts');
    expect(pluralize(2, 'New read')).toBe('New reads');
  });

  it('treats null/undefined as plural (empty or unknown tally)', () => {
    expect(pluralize(null, 'Catalyst')).toBe('Catalysts');
    expect(pluralize(undefined, 'Catalyst')).toBe('Catalysts');
  });

  it('honours an irregular plural override', () => {
    expect(pluralize(1, 'company', 'companies')).toBe('company');
    expect(pluralize(3, 'company', 'companies')).toBe('companies');
  });
});
