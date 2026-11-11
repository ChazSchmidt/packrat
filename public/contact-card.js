import { parseContact, contactText, lxmfFromIdentity } from './codec.js';
function decodeBase64Url(value, label) {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(value) || value.length % 4 === 1)
    throw new Error(`The contact card has an invalid ${label}.`);
  try {
    return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (char) =>
      char.charCodeAt(0),
    );
  } catch {
    throw new Error(`The contact card has an invalid ${label}.`);
  }
}
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
async function identityFor(key) {
  if (!globalThis.crypto?.subtle) throw new Error('Reading this contact card requires HTTPS.');
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', key)).slice(0, 16));
}
export async function parseContactCard(text) {
  const raw = text.trim();
  if (/^lxma:\/\//i.test(raw)) {
    const data = parseContact(raw),
      legacy = contactText(data),
      key = data.slice(16),
      address = hex(data.slice(0, 16)),
      identity = await identityFor(key);
    if ((await lxmfFromIdentity(identity)) !== address)
      throw new Error('The contact card’s address does not match its public key.');
    return {
      format: 'lxma',
      text: legacy,
      legacy,
      address,
      identity,
      publicKey: hex(key),
      name: '',
      kind: 'person',
      caps: [],
    };
  }
  const fields = raw.split(':');
  let name,
    address,
    identity,
    key,
    kind = 'person',
    caps = [];
  if (fields[0] === 'RSCP1' && fields.length === 5) [, name, address, identity, key] = fields;
  else if (fields[0] === 'RSCP2' && fields.length === 7) {
    [, kind, name, address, identity, key] = fields;
    if (!/^[a-z0-9._-]{1,32}$/i.test(kind))
      throw new Error('The contact card has an invalid kind.');
    caps = fields[6] ? fields[6].split(',') : [];
    if (caps.length > 16 || caps.some((cap) => !/^[a-z0-9._-]{1,32}$/i.test(cap)))
      throw new Error('The contact card has invalid capabilities.');
  } else
    throw new Error(
      'Choose a Ratspeak contact QR, or paste a complete RSCP1, RSCP2 or lxma:// contact card.',
    );
  if (raw.length > 1024)
    throw new Error('This contact card is too large. The maximum is 1,024 characters.');
  if (!/^[a-f0-9]{32}$/i.test(address) || !/^[a-f0-9]{32}$/i.test(identity))
    throw new Error('The contact card has an invalid address or identity hash.');
  let displayName;
  try {
    displayName = new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64Url(name, 'name'));
  } catch {
    throw new Error('The contact card has an invalid name.');
  }
  const publicKey = decodeBase64Url(key, 'public key');
  if (publicKey.length !== 64)
    throw new Error('The contact card must contain the full 64-byte public key.');
  if ((await identityFor(publicKey)) !== identity.toLowerCase())
    throw new Error('The contact card’s identity does not match its public key.');
  if ((await lxmfFromIdentity(identity)) !== address.toLowerCase())
    throw new Error('The contact card’s address does not match its public key.');
  const legacy = 'lxma://' + address.toLowerCase() + ':' + hex(publicKey);
  return {
    format: fields[0],
    text: raw,
    legacy,
    address: address.toLowerCase(),
    identity: identity.toLowerCase(),
    publicKey: hex(publicKey),
    name: displayName,
    kind,
    caps,
  };
}
// Compatibility helper used to compare address/key contents across formats.
export async function normalizeContactCard(text) {
  return (await parseContactCard(text)).legacy;
}
export async function toRatspeakContactCard(contact) {
  const bytes = parseContact(contact),
    address = hex(bytes.slice(0, 16)),
    key = bytes.slice(16),
    identity = await identityFor(key);
  if ((await lxmfFromIdentity(identity)) !== address)
    throw new Error('The contact card’s address does not match its public key.');
  const keyBase64 = btoa(String.fromCharCode(...key))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `RSCP1::${address}:${identity}:${keyBase64}`;
}
