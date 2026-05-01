import { test, expect } from '@playwright/test';
import { parsePrefixToken } from '../../src/app/core/util/parse-prefix-token';

test.describe('parsePrefixToken', () => {
  test('returns null token for plain text', () => {
    expect(parsePrefixToken('foo')).toEqual({ token: null, term: 'foo' });
  });
  test('returns empty parse for empty string', () => {
    expect(parsePrefixToken('')).toEqual({ token: null, term: '' });
  });
  test('parses > as command token', () => {
    expect(parsePrefixToken('>switch')).toEqual({ token: '>', term: 'switch' });
  });
  test('parses @ as company token', () => {
    expect(parsePrefixToken('@bms')).toEqual({ token: '@', term: 'bms' });
  });
  test('parses # as trial token', () => {
    expect(parsePrefixToken('#KEYNOTE')).toEqual({ token: '#', term: 'KEYNOTE' });
  });
  test('parses ! as catalyst token', () => {
    expect(parsePrefixToken('!q3')).toEqual({ token: '!', term: 'q3' });
  });
  test('returns empty term when only the token is typed', () => {
    expect(parsePrefixToken('>')).toEqual({ token: '>', term: '' });
  });
  test('preserves case in term', () => {
    expect(parsePrefixToken('#NCT02578680')).toEqual({ token: '#', term: 'NCT02578680' });
  });
  test('only treats the prefix when it is the first character', () => {
    expect(parsePrefixToken('a>b')).toEqual({ token: null, term: 'a>b' });
  });
});
