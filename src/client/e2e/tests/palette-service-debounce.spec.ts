import { test, expect } from '@playwright/test';
import { coalesceQuery } from '../../src/app/core/util/coalesce-query';

test.describe('coalesceQuery', () => {
  test('emits the last query after the debounce window', async () => {
    const calls: string[] = [];
    const debounced = coalesceQuery(80, (q) => { calls.push(q); });
    debounced('a');
    debounced('ab');
    debounced('abc');
    await new Promise((r) => setTimeout(r, 200));
    expect(calls).toEqual(['abc']);
  });
  test('emits multiple times when calls are spaced beyond the window', async () => {
    const calls: string[] = [];
    const debounced = coalesceQuery(40, (q) => { calls.push(q); });
    debounced('first');
    await new Promise((r) => setTimeout(r, 100));
    debounced('second');
    await new Promise((r) => setTimeout(r, 100));
    expect(calls).toEqual(['first', 'second']);
  });
});
