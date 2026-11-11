import { parsePaperUri, paperUriFromBytes, MAX_PAPER_BYTES } from './paper-message.js';
// Legacy block codec: JavaScript implementation informed by Benn Jordan's
// zip-image-stego RobustBlockFileSteg center/edge luminance approach.
// Reference: https://github.com/bennjordan/zip-image-stego/blob/main/stego_engine.py
// Separate packet format and Web Crypto encryption; upstream Python is not bundled.
export const VERSION = 1;
const ADDRESS_VERSION = 2,
  NATIVE_VERSION = 3,
  IDENTITY_VERSION = 4,
  PAPER_VERSION = 5;
const MAGIC = [82, 83, 83, 84]; // RSST
const HEADER = 8,
  REPEAT = 3,
  STRENGTH = 24;
export const ITERATIONS = 600000;
const join = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};
export function crc32(data) {
  let c = 0xffffffff;
  for (const b of data) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
export function parseContact(text) {
  const contact = text.trim();
  if (!/^lxma:\/\/[0-9a-f]{32}:[0-9a-f]{128}$/i.test(contact))
    throw new Error(
      'Paste a full lxma:// contact: 32 hex characters, a colon, then 128 hex characters.',
    );
  const hex = contact.slice(7).replace(':', '');
  return Uint8Array.from(hex.match(/../g), (b) => parseInt(b, 16));
}
export function contactText(bytes) {
  if (bytes.length !== 80) throw new Error('The recovered contact has an invalid length.');
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return 'lxma://' + hex.slice(0, 32) + ':' + hex.slice(32);
}
function hexText(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
export function parseHash(text) {
  const hash = text.trim().replace(/^<([0-9a-f]{32})>$/i, '$1');
  if (!/^[0-9a-f]{32}$/i.test(hash))
    throw new Error(
      'Paste a 32-character LXMF address or identity hash, or a full lxma:// contact card.',
    );
  return Uint8Array.from(hash.match(/../g), (b) => parseInt(b, 16));
}
export async function lxmfFromIdentity(text) {
  const identity = parseHash(text);
  requireCrypto();
  // Reticulum Destination.hash: SHA256(SHA256("lxmf.delivery")[:10] || identity)[:16].
  const name = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode('lxmf.delivery')),
  ).slice(0, 10);
  return hexText(
    new Uint8Array(await crypto.subtle.digest('SHA-256', join(name, identity))).slice(0, 16),
  );
}
function requireCrypto() {
  if (!globalThis.crypto?.subtle)
    throw new Error(
      'This operation requires HTTPS. Use an HTTPS site, localhost, or the downloaded offline app.',
    );
}
async function keyFor(password, salt) {
  requireCrypto();
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function makePacket(text, password = '', hashType = 'lxmf') {
  const raw = text.trim(),
    native = /^RSCP[12]:/.test(raw),
    fullCard = /^lxma:\/\//i.test(raw) || native,
    paper = /^lxm:\/\//i.test(raw),
    encrypted = password.length > 0;
  if (!fullCard && !paper && !['lxmf', 'identity'].includes(hashType))
    throw new Error('Choose whether the hash is an LXMF address or an identity hash.');
  const contact = paper
    ? parsePaperUri(raw).bytes
    : native
      ? new TextEncoder().encode(raw)
      : fullCard
        ? parseContact(raw)
        : parseHash(raw);
  if (native && contact.length > 1024) throw new Error('This contact card is too large.');
  const version = paper
    ? PAPER_VERSION
    : native
      ? NATIVE_VERSION
      : fullCard
        ? VERSION
        : hashType === 'identity'
          ? IDENTITY_VERSION
          : ADDRESS_VERSION;
  const bodyLength = contact.length + (encrypted ? 44 : 0);
  const header = Uint8Array.from([
    ...MAGIC,
    version,
    encrypted ? 1 : 0,
    bodyLength >> 8,
    bodyLength & 255,
  ]);
  let body = contact;
  if (encrypted) {
    requireCrypto();
    const salt = crypto.getRandomValues(new Uint8Array(16)),
      iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await keyFor(password, salt);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: header, tagLength: 128 },
        key,
        contact,
      ),
    );
    body = join(salt, iv, ciphertext);
  }
  const content = join(header, body),
    checksum = new Uint8Array(4);
  new DataView(checksum.buffer).setUint32(0, crc32(content));
  return join(content, checksum);
}
export function packetLength(header) {
  if (
    ![VERSION, ADDRESS_VERSION, NATIVE_VERSION, IDENTITY_VERSION, PAPER_VERSION].includes(header[4])
  )
    throw new Error('This image uses an unsupported Packrat version.');
  const bodyLength = header[6] * 256 + header[7],
    plainLength = bodyLength - (header[5] ? 44 : 0);
  const valid =
    header[4] === PAPER_VERSION
      ? plainLength >= 112 && plainLength <= MAX_PAPER_BYTES
      : header[4] === NATIVE_VERSION
        ? plainLength > 0 && plainLength <= 1024
        : plainLength === (header[4] === VERSION ? 80 : 16);
  if (header[5] > 1 || !valid)
    throw new Error('The hidden header is damaged or unsupported. Try the original image.');
  return HEADER + bodyLength + 4;
}
export function inspectPacket(packet) {
  if (packet.length < HEADER || !MAGIC.every((b, i) => packet[i] === b))
    throw new Error(
      'No Packrat contact found. Try the original downloaded image; resizing or cropping can erase the payload.',
    );
  const size = packetLength(packet);
  if (packet.length < size)
    throw new Error('The hidden contact is incomplete. Try the original image.');
  const data = packet.slice(0, size),
    expected = new DataView(data.buffer).getUint32(size - 4);
  if (crc32(data.subarray(0, size - 4)) !== expected)
    throw new Error(
      'A hidden contact was detected, but it is damaged. Try the original file or a higher-quality JPEG.',
    );
  return {
    encrypted: !!packet[5],
    kind:
      packet[4] === PAPER_VERSION
        ? 'paper'
        : [VERSION, NATIVE_VERSION].includes(packet[4])
          ? 'card'
          : packet[4] === IDENTITY_VERSION
            ? 'identity'
            : 'address',
    data,
  };
}
export async function openPacket(packet, password = '') {
  const { encrypted, data, kind } = inspectPacket(packet);
  const format = (bytes) => {
    if (data[4] === PAPER_VERSION) return paperUriFromBytes(bytes);
    if (data[4] === NATIVE_VERSION) {
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw new Error('The hidden card text is damaged.');
      }
      if (!/^RSCP[12]:/.test(text)) throw new Error('The hidden card format is unsupported.');
      return text;
    }
    return kind === 'card' ? contactText(bytes) : hexText(bytes);
  };
  if (!encrypted) return format(data.slice(HEADER, -4));
  if (!password) throw new Error('Enter the password used to protect this data.');
  const body = data.slice(HEADER, -4),
    salt = body.slice(0, 16),
    iv = body.slice(16, 28),
    key = await keyFor(password, salt);
  try {
    return format(
      new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv, additionalData: data.slice(0, HEADER), tagLength: 128 },
          key,
          body.slice(28),
        ),
      ),
    );
  } catch {
    throw new Error('That password could not unlock the data. Check it and try again.');
  }
}
export function hammingEncode(bytes) {
  const out = [];
  for (const byte of bytes)
    for (const shift of [4, 0]) {
      const n = (byte >> shift) & 15,
        d1 = (n >> 3) & 1,
        d2 = (n >> 2) & 1,
        d3 = (n >> 1) & 1,
        d4 = n & 1;
      out.push(d1 ^ d2 ^ d4, d1 ^ d3 ^ d4, d1, d2 ^ d3 ^ d4, d2, d3, d4);
    }
  return out;
}
export function hammingDecode(bits) {
  const nibbles = [];
  let corrected = 0;
  for (let i = 0; i + 6 < bits.length; i += 7) {
    const b = bits.slice(i, i + 7);
    const pos =
      (b[0] ^ b[2] ^ b[4] ^ b[6]) +
      2 * (b[1] ^ b[2] ^ b[5] ^ b[6]) +
      4 * (b[3] ^ b[4] ^ b[5] ^ b[6]);
    if (pos) {
      b[pos - 1] ^= 1;
      corrected++;
    }
    nibbles.push((b[2] << 3) | (b[4] << 2) | (b[5] << 1) | b[6]);
  }
  const data = new Uint8Array(Math.floor(nibbles.length / 2));
  for (let i = 0; i < data.length; i++) data[i] = (nibbles[i * 2] << 4) | nibbles[i * 2 + 1];
  return { data, corrected };
}
export function requiredBlocks(bytes) {
  return bytes * 14 * REPEAT;
}
function orderFor(width, height) {
  const n = Math.floor(width / 8) * Math.floor(height / 8),
    order = Uint32Array.from({ length: n }, (_, i) => i);
  // Public, fixed shuffle distributes modifications. It provides no secrecy.
  let seed = 0x52535354;
  for (let i = n - 1; i > 0; i--) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const j = (seed >>> 0) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
function difference(image, block) {
  const { data, width } = image,
    cols = Math.floor(width / 8),
    bx = (block % cols) * 8,
    by = Math.floor(block / cols) * 8;
  let center = 0,
    edge = 0;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const p = ((by + y) * width + bx + x) * 4,
        v = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      if (x >= 2 && x < 6 && y >= 2 && y < 6) center += v;
      else edge += v;
    }
  return center / 16 - edge / 48;
}
export function embed(image, packet) {
  const order = orderFor(image.width, image.height),
    bits = hammingEncode(packet);
  if (order.length < bits.length * REPEAT)
    throw new Error('This image is too small. Choose a larger image.');
  const { data, width } = image,
    cols = Math.floor(width / 8);
  for (let i = 0; i < bits.length; i++)
    for (let r = 0; r < REPEAT; r++) {
      const block = order[i * REPEAT + r],
        bx = (block % cols) * 8,
        by = Math.floor(block / cols) * 8,
        target = bits[i] ? STRENGTH : -STRENGTH;
      for (let pass = 0; pass < 8; pass++) {
        const diff = difference(image, block);
        if (target > 0 ? diff >= target - 0.5 : diff <= target + 0.5) break;
        const delta = target - diff;
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++) {
            const p = ((by + y) * width + bx + x) * 4,
              center = x >= 2 && x < 6 && y >= 2 && y < 6,
              change = delta * (center ? 0.75 : -0.25);
            for (let c = 0; c < 3; c++)
              data[p + c] = Math.max(0, Math.min(255, Math.round(data[p + c] + change)));
          }
      }
    }
  return image;
}
export function extract(image) {
  const order = orderFor(image.width, image.height),
    bits = [];
  function read(bytes) {
    const count = bytes * 14;
    if (order.length < count * REPEAT)
      throw new Error('This image is too small to contain a Packrat contact.');
    for (let i = bits.length; i < count; i++) {
      let votes = 0;
      for (let r = 0; r < REPEAT; r++)
        votes += difference(image, order[i * REPEAT + r]) > 0 ? 1 : 0;
      bits.push(votes >= 2 ? 1 : 0);
    }
    return hammingDecode(bits);
  }
  const header = read(HEADER).data;
  if (!MAGIC.every((b, i) => header[i] === b))
    throw new Error(
      'No Packrat contact found. Try the original downloaded image; resizing or cropping can erase the payload.',
    );
  const { data, corrected } = read(packetLength(header));
  return { ...inspectPacket(data), corrected };
}
