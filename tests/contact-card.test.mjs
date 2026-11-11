import { webcrypto, createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeContactCard,
  toRatspeakContactCard,
  parseContactCard,
} from '../public/contact-card.js';
if (!globalThis.crypto?.subtle)
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const key = Buffer.from(Array.from({ length: 64 }, (_, i) => i)),
  hash = (data) => createHash('sha256').update(data).digest();
const identity = hash(key).subarray(0, 16).toString('hex');
const address = hash(
  Buffer.concat([hash('lxmf.delivery').subarray(0, 10), Buffer.from(identity, 'hex')]),
)
  .subarray(0, 16)
  .toString('hex');
const name = Buffer.from('Alice Example').toString('base64url'),
  base64 = key.toString('base64url');
const legacy = 'lxma://' + address + ':' + key.toString('hex');
const v1 = `RSCP1:${name}:${address}:${identity}:${base64}`,
  v2 = `RSCP2:person:${name}:${address}:${identity}:${base64}:`;
test('normalizes current and older Ratspeak cards to the full address and key', async () => {
  for (const card of [
    v1,
    v2,
    `RSCP2:person::${address}:${identity}:${key.toString('base64').replace(/\+/g, '-').replace(/\//g, '_')}:`,
  ])
    assert.equal(await normalizeContactCard(card), legacy);
  assert.equal(await normalizeContactCard(' ' + legacy.toUpperCase() + ' '), legacy);
});
test('rejects malformed cards and truncated public keys', async () => {
  for (const value of [
    'RSCP1:',
    'RSCP2:person:',
    v2 + ':extra',
    v2.replace(base64, 'bad'),
    v2.replace(name, '%%%'),
  ])
    await assert.rejects(normalizeContactCard(value));
});
test('rejects identity/address/key contradictions', async () => {
  await assert.rejects(
    normalizeContactCard(v2.replace(identity, '00'.repeat(16))),
    /identity does not match/,
  );
  await assert.rejects(
    normalizeContactCard(v2.replace(address, '00'.repeat(16))),
    /address does not match/,
  );
  const other = Buffer.alloc(64, 7).toString('base64url');
  await assert.rejects(normalizeContactCard(v2.replace(base64, other)), /identity does not match/);
});
test('preserves RSCP2 device kind, name and capabilities', async () => {
  const raw = v2.replace('person:', 'device:') + 'rsnode,rsnode.update';
  const card = await parseContactCard(raw);
  assert.equal(card.text, raw);
  assert.equal(card.kind, 'device');
  assert.deepEqual(card.caps, ['rsnode', 'rsnode.update']);
  assert.equal(card.name, 'Alice Example');
  await assert.rejects(parseContactCard(v2 + 'bad cap'), /capabilities/);
});

test('native output matches RSCP1-only scanners with unpadded base64url', async () => {
  const card = await toRatspeakContactCard(legacy);
  assert.equal(card, `RSCP1::${address}:${identity}:${base64}`);
  assert.equal(card.split(':').length, 5);
  assert.equal(card.includes('='), false);
  assert.equal(await normalizeContactCard(card), legacy);
  await assert.rejects(
    toRatspeakContactCard(legacy.replace(address, '00'.repeat(16))),
    /address does not match/,
  );
});
