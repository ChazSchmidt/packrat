import { webcrypto } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePacket, openPacket, inspectPacket } from '../public/codec.js';
import { embed, extract } from '../public/image-codec.js';
import { contact } from './contact-fixture.mjs';
import { parseContactCard, toRatspeakContactCard } from '../public/contact-card.js';
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
function image(tone = 130) {
  const width = 800,
    height = 600,
    data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = tone;
    data[i + 3] = 255;
  }
  return { width, height, data };
}
function clone(source) {
  return { ...source, data: new Uint8ClampedArray(source.data) };
}
for (const tone of [0, 130, 255])
  test('subtle encoding changes colour channels by at most 1 at tone ' + tone, async () => {
    const source = image(tone),
      pixels = clone(source),
      packet = await makePacket(contact, 'image password');
    embed(pixels, packet, 'subtle');
    let changed = 0;
    for (let i = 0; i < pixels.data.length; i++) {
      assert.ok(Math.abs(pixels.data[i] - source.data[i]) <= 1);
      if (i % 4 === 3) assert.equal(pixels.data[i], 255);
      if (pixels.data[i] !== source.data[i]) changed++;
    }
    assert.ok(changed > 0);
    assert.deepEqual(extract(pixels).data, packet);
    assert.equal(await openPacket(extract(pixels).data, 'image password'), contact);
  });
test('gentle DCT round-trip has much lower distortion than the original block codec', async () => {
  const source = image(),
    old = clone(source),
    gentle = clone(source),
    packet = await makePacket(contact);
  embed(old, packet, 'legacy');
  embed(gentle, packet, 'jpeg');
  assert.deepEqual(extract(gentle).data, packet);
  assert.deepEqual(extract(old).data, packet);
  let oldError = 0,
    newError = 0;
  for (let i = 0; i < old.data.length; i++) {
    oldError += (old.data[i] - source.data[i]) ** 2;
    newError += (gentle.data[i] - source.data[i]) ** 2;
  }
  assert.ok(newError < oldError / 5);
});
test('native card packet preserves every original field, open and encrypted', async () => {
  const v1 = await toRatspeakContactCard(contact),
    card = await parseContactCard(v1),
    name = btoa('Example Name'),
    key = v1.split(':')[4];
  const native = `RSCP2:device:${name}:${card.address}:${card.identity}:${key}:rsnode,rsnode.update`;
  for (const password of ['', 'native card password']) {
    const packet = await makePacket(native, password);
    assert.equal(packet[4], 3);
    assert.equal(inspectPacket(packet).kind, 'card');
    const pixels = image();
    embed(pixels, packet);
    assert.equal(await openPacket(extract(pixels).data, password), native);
  }
});
test('identity packets retain the original hash so it can be copied', async () => {
  const identity = '0123456789abcdef0123456789abcdef';
  for (const password of ['', 'identity password']) {
    const packet = await makePacket(identity, password, 'identity');
    assert.equal(packet[4], 4);
    assert.equal(inspectPacket(packet).kind, 'identity');
    const pixels = image();
    embed(pixels, packet);
    assert.equal(await openPacket(extract(pixels).data, password), identity);
  }
});
