/**
 * Pure-logic tests for the command-palette hotkey predicate. The service itself
 * registers a `document` keydown listener, which the node-environment unit runner
 * (vitest.units.config.ts) has no DOM for, so we exercise `shouldOpenPalette`
 * directly. This is the behaviour that must survive the zoneless refactor (the
 * NgZone wrapper was removed; the open/close logic is unchanged).
 */
import { describe, expect, it } from 'vitest';
import { shouldOpenPalette } from './palette-hotkey.service';

function ev(partial: Partial<KeyboardEvent> & { target?: unknown }): KeyboardEvent {
  return partial as unknown as KeyboardEvent;
}

describe('shouldOpenPalette', () => {
  it('opens on Cmd+K (metaKey)', () => {
    expect(shouldOpenPalette(ev({ key: 'k', metaKey: true }))).toBe(true);
  });

  it('opens on Ctrl+K (ctrlKey)', () => {
    expect(shouldOpenPalette(ev({ key: 'K', ctrlKey: true }))).toBe(true);
  });

  it('does not open on a bare "k"', () => {
    expect(shouldOpenPalette(ev({ key: 'k' }))).toBe(false);
  });

  it('opens on "/" when focus is not in a text field', () => {
    expect(shouldOpenPalette(ev({ key: '/', target: { tagName: 'DIV' } }))).toBe(true);
  });

  it('does not open on "/" while typing in an INPUT', () => {
    expect(shouldOpenPalette(ev({ key: '/', target: { tagName: 'INPUT' } }))).toBe(false);
  });

  it('does not open on "/" while typing in a TEXTAREA', () => {
    expect(shouldOpenPalette(ev({ key: '/', target: { tagName: 'TEXTAREA' } }))).toBe(false);
  });

  it('does not open on "/" inside a contenteditable host', () => {
    expect(shouldOpenPalette(ev({ key: '/', target: { isContentEditable: true } }))).toBe(false);
  });

  it('ignores unrelated keys', () => {
    expect(shouldOpenPalette(ev({ key: 'Escape' }))).toBe(false);
    expect(shouldOpenPalette(ev({ key: 'Enter' }))).toBe(false);
  });
});
