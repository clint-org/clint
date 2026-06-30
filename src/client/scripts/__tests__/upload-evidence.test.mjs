import { test } from 'node:test';
import assert from 'node:assert';
import { publicUrlFor, objectKeyFor } from '../upload-evidence.mjs';

test('objectKeyFor builds the issues prefix key', () => {
  assert.equal(objectKeyFor('157', 'after-prod.png'), 'issues/157/after-prod.png');
});

test('publicUrlFor builds the clintapp evidence URL', () => {
  assert.equal(
    publicUrlFor('157', 'after-prod.png'),
    'https://clintapp.com/evidence/issues/157/after-prod.png'
  );
});
