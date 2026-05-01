import { test, expect } from '@playwright/test';
import { shouldOpenPalette } from '../../src/app/core/services/palette-hotkey.service';

function targetWith(tag: string, contentEditable = false): EventTarget {
  return {
    tagName: tag.toUpperCase(),
    isContentEditable: contentEditable,
    nodeType: 1,
  } as unknown as EventTarget;
}

test.describe('shouldOpenPalette', () => {
  test('Cmd+K opens', () => {
    const ev = { key: 'k', metaKey: true, ctrlKey: false, target: targetWith('body') } as unknown as KeyboardEvent;
    expect(shouldOpenPalette(ev)).toBe(true);
  });
  test('Ctrl+K opens', () => {
    const ev = { key: 'k', metaKey: false, ctrlKey: true, target: targetWith('body') } as unknown as KeyboardEvent;
    expect(shouldOpenPalette(ev)).toBe(true);
  });
  test('/ opens when target is body', () => {
    const ev = { key: '/', metaKey: false, ctrlKey: false, target: targetWith('body') } as unknown as KeyboardEvent;
    expect(shouldOpenPalette(ev)).toBe(true);
  });
  test('/ does NOT open when target is INPUT', () => {
    const ev = { key: '/', metaKey: false, ctrlKey: false, target: targetWith('input') } as unknown as KeyboardEvent;
    expect(shouldOpenPalette(ev)).toBe(false);
  });
  test('/ does NOT open when target is TEXTAREA', () => {
    const ev = { key: '/', metaKey: false, ctrlKey: false, target: targetWith('textarea') } as unknown as KeyboardEvent;
    expect(shouldOpenPalette(ev)).toBe(false);
  });
  test('/ does NOT open when target is contentEditable', () => {
    const ev = { key: '/', metaKey: false, ctrlKey: false, target: targetWith('div', true) } as unknown as KeyboardEvent;
    expect(shouldOpenPalette(ev)).toBe(false);
  });
  test('Cmd+K opens even from inside an input', () => {
    const ev = { key: 'k', metaKey: true, ctrlKey: false, target: targetWith('input') } as unknown as KeyboardEvent;
    expect(shouldOpenPalette(ev)).toBe(true);
  });
  test('plain k does nothing', () => {
    const ev = { key: 'k', metaKey: false, ctrlKey: false, target: targetWith('body') } as unknown as KeyboardEvent;
    expect(shouldOpenPalette(ev)).toBe(false);
  });
});
