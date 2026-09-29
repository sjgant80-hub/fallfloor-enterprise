// dual-map · hash.test.mjs — the vendored primitive is correct (known SHA-256 vector) and canon is
// deterministic. If these drift, every receipt hash is meaningless, so they are gated too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256, canon } from './hash.mjs';

test('sha256 matches the known NIST vector for "abc"', () => {
  const r = sha256('abc');
  assert.equal(r.ok, true);
  assert.equal(r.hash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('sha256 of the empty string is the known vector', () => {
  assert.equal(sha256('').hash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('sha256 refuses a non-string without throwing', () => {
  assert.equal(sha256(42).ok, false);
  assert.equal(sha256(null).ok, false);
});

test('canon is key-order independent (so a receipt hashes the same however its fields are ordered)', () => {
  assert.equal(canon({ a: 1, b: 2 }), canon({ b: 2, a: 1 }));
  assert.notEqual(canon({ a: 1 }), canon({ a: 2 }));
  assert.equal(canon([1, 'x', true, null]), '[1,"x",true,null]');
});
