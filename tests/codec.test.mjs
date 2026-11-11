import { webcrypto, pbkdf2Sync, createDecipheriv } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makePacket,
  openPacket,
  parseContact,
  inspectPacket,
  crc32,
  hammingEncode,
  hammingDecode,
  embed,
  extract,
  requiredBlocks,
  lxmfFromIdentity,
} from '../public/codec.js';
if (!globalThis.crypto?.subtle)
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const contact = 'lxma://' + '12'.repeat(16) + ':' + 'ab'.repeat(64);
function image(kind = 'pattern') {
  const width = 768,
    height = 768,
    data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      for (let c = 0; c < 3; c++)
        data[p + c] =
          kind === 'white'
            ? 255
            : kind === 'black'
              ? 0
              : kind === 'noise'
                ? (x * 179 + y * 97 + c * 83) % 256
                : Math.round(128 + 90 * Math.sin(x * 0.03 + c) * Math.cos(y * 0.02));
      data[p + 3] = 255;
    }
  return { width, height, data };
}
test('full binary contact round-trip, mixed case and validation', async () => {
  const packet = await makePacket(contact);
  assert.equal(packet.length, 92);
  assert.equal(await openPacket(packet), contact);
  assert.deepEqual(parseContact(contact.toUpperCase()), parseContact(contact));
  for (const bad of [
    'lxma://',
    'lxma://' + 'ab'.repeat(16),
    contact + ':extra',
    contact.replace('ab', 'gg'),
  ])
    assert.throws(() => parseContact(bad));
});
test('AES-GCM password round-trip, wrong password, salt uniqueness and corruption', async () => {
  const packet = await makePacket(contact, 'a long test passphrase');
  assert.equal(packet.length, 136);
  assert.equal(inspectPacket(packet).encrypted, true);
  assert.equal(await openPacket(packet, 'a long test passphrase'), contact);
  await assert.rejects(openPacket(packet, 'wrong'), /password/);
  await assert.rejects(openPacket(packet), /Enter/);
  assert.notDeepEqual(packet, await makePacket(contact, 'a long test passphrase'));
  packet[50] ^= 1;
  assert.throws(() => inspectPacket(packet), /damaged/);
});
test('Hamming repairs each single bit position in every word', () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i),
    bits = hammingEncode(bytes);
  for (let position = 0; position < 7; position++) {
    const bad = [...bits];
    for (let i = position; i < bad.length; i += 7) bad[i] ^= 1;
    assert.deepEqual(hammingDecode(bad).data, bytes);
  }
});
for (const kind of ['pattern', 'white', 'black', 'noise'])
  test('pixel packet survives on ' + kind, async () => {
    const packet = await makePacket(contact, 'spatial test password'),
      pixels = image(kind);
    embed(pixels, packet);
    assert.deepEqual(extract(pixels).data, packet);
    assert.equal(await openPacket(extract(pixels).data, 'spatial test password'), contact);
  });
test('ordinary image and tiny image fail clearly', () => {
  assert.throws(() => extract(image()), /No Packrat/);
  assert.throws(
    () => extract({ width: 8, height: 8, data: new Uint8ClampedArray(256) }),
    /too small/,
  );
  assert.equal(requiredBlocks(136), 5712);
});

test('LXMF address-only packets are distinct, compact and preserve normalized hashes', async () => {
  const hash = '0123456789abcdef0123456789abcdef';
  const packet = await makePacket(' <' + hash.toUpperCase() + '> ');
  assert.equal(packet[4], 2);
  assert.equal(packet.length, 28);
  assert.equal(inspectPacket(packet).kind, 'address');
  assert.equal(await openPacket(packet), hash);
  const pixels = image();
  embed(pixels, packet);
  assert.equal(await openPacket(extract(pixels).data), hash);
  // Same hex text remains an LXMF destination by default; no silent identity conversion.
  assert.equal(await openPacket(await makePacket(hash)), hash);
});
test('encrypted address-only packets recover and authenticate', async () => {
  const hash = 'ab'.repeat(16),
    packet = await makePacket(hash, 'address passphrase');
  assert.equal(packet.length, 72);
  assert.equal(inspectPacket(packet).kind, 'address');
  assert.equal(await openPacket(packet, 'address passphrase'), hash);
  await assert.rejects(openPacket(packet, 'wrong'), /password/);
  const pixels = image();
  embed(pixels, packet);
  assert.equal(await openPacket(extract(pixels).data, 'address passphrase'), hash);
});
test('explicit identity hashes derive the correct LXMF destination using independent Python SHA256 vectors', async () => {
  for (const [identity, expected] of [
    ['00'.repeat(16), '061e06ee8d11fdc76a98f644d9639e60'],
    ['12'.repeat(16), '6fa408114a0e6b815d46109455384180'],
    ['0123456789abcdef0123456789abcdef', 'fa6850ef667ced161d62458a00cc4d9b'],
  ]) {
    assert.equal(await openPacket(await makePacket(identity, '', 'identity')), identity);
    assert.equal(await lxmfFromIdentity(identity), expected);
  }
});
test('ambiguous hash type and malformed addresses are rejected', async () => {
  for (const value of [
    'abc',
    'aa'.repeat(17),
    'g'.repeat(32),
    '<' + '12'.repeat(16),
    '<' + '12'.repeat(16) + '>:extra',
  ])
    await assert.rejects(makePacket(value), /32-character/);
  await assert.rejects(makePacket('12'.repeat(16), '', 'guess'), /Choose whether/);
  const bad = new Uint8Array(await makePacket('12'.repeat(16)));
  bad[7] = 80;
  assert.throws(() => inspectPacket(bad), /damaged/);
});

test('encrypted packet independently decrypts using 600,000 PBKDF2 rounds and a 128-bit GCM tag', async () => {
  const password = '  café 🔐 ' + 'random word '.repeat(12);
  const packet = await makePacket(contact, password),
    body = packet.subarray(8, -4);
  const key = pbkdf2Sync(password, body.subarray(0, 16), 600000, 32, 'sha256');
  const decipher = createDecipheriv('aes-256-gcm', key, body.subarray(16, 28), {
    authTagLength: 16,
  });
  decipher.setAAD(packet.subarray(0, 8));
  decipher.setAuthTag(body.subarray(-16));
  const plaintext = Buffer.concat([decipher.update(body.subarray(28, -16)), decipher.final()]);
  assert.deepEqual(plaintext, Buffer.from(parseContact(contact)));
  assert.equal(await openPacket(packet, password), contact);
});
test('GCM rejects ciphertext tampering even when the attacker recomputes the public CRC', async () => {
  const packet = await makePacket(contact, 'unique test passphrase');
  packet[40] ^= 1;
  new DataView(packet.buffer, packet.byteOffset, packet.byteLength).setUint32(
    packet.length - 4,
    crc32(packet.subarray(0, -4)),
  );
  assert.equal(inspectPacket(packet).encrypted, true);
  await assert.rejects(openPacket(packet, 'unique test passphrase'), /could not unlock/);
});
