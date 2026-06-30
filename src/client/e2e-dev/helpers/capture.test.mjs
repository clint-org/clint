import { test } from 'node:test';
import assert from 'node:assert';
import { captureParamsFromEnv } from './capture.mjs';

test('reads path and out', () => {
  assert.deepEqual(captureParamsFromEnv({ CAPTURE_PATH: '/timeline', CAPTURE_OUT: '/tmp/a.png' }), {
    path: '/timeline',
    out: '/tmp/a.png',
    seed: undefined,
  });
});

test('passes through an optional seed name', () => {
  assert.equal(
    captureParamsFromEnv({ CAPTURE_PATH: '/x', CAPTURE_OUT: '/tmp/x.png', CAPTURE_SEED: 'oneTrial' }).seed,
    'oneTrial'
  );
});

test('throws when a required var is missing', () => {
  assert.throws(() => captureParamsFromEnv({ CAPTURE_PATH: '/x' }), /CAPTURE_OUT/);
});
