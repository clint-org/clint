import { describe, it, expect } from 'vitest';
import { extractionTemperature } from './temperature';

describe('extractionTemperature', () => {
  it('returns 0.2 for sonnet 4.6 (accepts temperature)', () => {
    expect(extractionTemperature('claude-sonnet-4-6')).toBe(0.2);
  });
  it('returns undefined for adaptive-thinking models that 400 on temperature', () => {
    expect(extractionTemperature('claude-opus-4-8')).toBeUndefined();
    expect(extractionTemperature('claude-opus-4-7')).toBeUndefined();
    expect(extractionTemperature('claude-sonnet-5')).toBeUndefined();
    expect(extractionTemperature('claude-fable-5')).toBeUndefined();
  });
  it('defaults to 0.2 for unknown/sonnet-family models', () => {
    expect(extractionTemperature('claude-haiku-4-5')).toBe(0.2);
  });
});
