import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePaperUri, paperUriFromBytes, MAX_PAPER_BYTES } from '../public/paper-message.js';
import { makePacket, openPacket, inspectPacket, packetLength } from '../public/codec.js';
import { embed, extract } from '../public/image-codec.js';
import { paperUri, paperDestination } from './paper-fixture.mjs';

test('reference-generated paper fixture retains destination and encrypted bytes', () => {
  const parsed = parsePaperUri(paperUri);
  assert.equal(parsed.destination, paperDestination);
  assert.equal(parsed.bytes.length, 256);
  assert.equal(paperUriFromBytes(parsed.bytes), paperUri);
  // Upstream accepts case-insensitive schemes, ASCII line wraps, trailing slashes/padding.
  assert.equal(
    parsePaperUri(' LXM://' + paperUri.slice(6, 70) + '\n' + paperUri.slice(70) + '=/ \t').text,
    paperUri,
  );
});
test('paper links reject malformed, incomplete, noncanonical and oversized input', () => {
  for (const value of [
    'lxma://abc',
    'lxm://',
    'lxm://abc?tracking=1',
    'lxm://abc#fragment',
    'lxm://abc+xyz',
    'lxm://' + 'A'.repeat(42),
    'lxm://' + 'A'.repeat(16384),
  ])
    assert.throws(() => parsePaperUri(value));
  assert.throws(() => paperUriFromBytes(new Uint8Array(MAX_PAPER_BYTES + 1)), /too large/);
  const short = paperUriFromBytes(new Uint8Array(112));
  assert.throws(() => parsePaperUri(short.slice(0, -1) + 'B'), /damaged/);
});
test('paper payload round-trip preserves canonical URI with and without a Packrat password', async () => {
  for (const password of ['', 'paper message test passphrase']) {
    const packet = await makePacket(paperUri, password);
    assert.equal(inspectPacket(packet).kind, 'paper');
    assert.equal(packetLength(packet), packet.length);
    assert.equal(packet.length, 256 + 12 + (password ? 44 : 0));
    assert.equal(await openPacket(packet, password), paperUri);
    if (password) await assert.rejects(openPacket(packet, 'wrong password'), /could not unlock/);
  }
});
test('both image codecs recover a recipient-encrypted paper message byte for byte', async () => {
  const packet = await makePacket(paperUri, 'outer paper password');
  for (const method of ['subtle', 'jpeg']) {
    const image = { width: 1200, height: 960, data: new Uint8ClampedArray(1200 * 960 * 4) };
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = 120;
      image.data[i + 1] = 145;
      image.data[i + 2] = 160;
      image.data[i + 3] = 255;
    }
    embed(image, packet, method);
    const found = extract(image);
    assert.equal(found.kind, 'paper');
    assert.equal(await openPacket(found.data, 'outer paper password'), paperUri);
  }
});
test('full upstream paper size fits the bounded packet, independently of visible URI length', async () => {
  const uri = paperUriFromBytes(new Uint8Array(MAX_PAPER_BYTES));
  assert.equal(uri.length, 2953);
  const packet = await makePacket(uri, 'full size passphrase');
  assert.equal(packet.length, 2210 + 44 + 12);
  assert.equal(await openPacket(packet, 'full size passphrase'), uri);
  const damaged = packet.slice(0, 8);
  damaged[6] = 255;
  damaged[7] = 255;
  assert.throws(() => packetLength(damaged), /damaged/);
});
