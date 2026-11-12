import { parsePaperUri } from './paper-message.js';
import { readContactQr } from './qr-reader.js';
import { toRatspeakContactCard, parseContactCard } from './contact-card.js';
import {
  makePacket,
  openPacket,
  requiredBlocks,
  parseHash,
  inspectPacket,
  lxmfFromIdentity,
} from './codec.js';
import { embed, extract } from './image-codec.js';
const $ = (id) => document.getElementById(id);
let encodedCanvas = null,
  encodedBlob = null,
  encodedURL = null,
  jpegURL = null,
  pending = null;
let encodeRevision = 0,
  decodeRevision = 0;
let payloadType = null;
const contactDrafts = { card: '', paper: '', lxmf: '', identity: '' };
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
// Photo-mode export starts at the chosen JPEG quality, rises if the packet
// does not survive, and falls back to PNG.
function photoExports(percent) {
  const steps = [percent, ...[85, 92, 97, 100].filter((q) => q > percent)];
  return [...steps.map((q) => ['image/jpeg', q / 100]), ['image/png']];
}
function photoQuality() {
  return Math.min(100, Math.max(70, Number($('photo-quality').value) || 100));
}
function status(id, text, kind = '') {
  $(id).textContent = text;
  $(id).dataset.kind = kind;
}
function tab(name) {
  for (const value of ['encode', 'decode']) {
    const selected = name === value;
    $(value + '-tab').setAttribute('aria-selected', String(selected));
    $(value + '-tab').tabIndex = selected ? 0 : -1;
    $(value + '-panel').hidden = !selected;
  }
}
for (const name of ['encode', 'decode']) {
  $(name + '-tab').onclick = () => tab(name);
  $(name + '-tab').onkeydown = (e) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const next =
        e.key === 'Home'
          ? 'encode'
          : e.key === 'End'
            ? 'decode'
            : name === 'encode'
              ? 'decode'
              : 'encode';
      tab(next);
      $(next + '-tab').focus();
    }
  };
}
function clearEncoded() {
  encodeRevision++;
  $('encode-result').hidden = true;
  encodedCanvas = null;
  encodedBlob = null;
  if (encodedURL) URL.revokeObjectURL(encodedURL);
  encodedURL = null;
  if (jpegURL) URL.revokeObjectURL(jpegURL);
  jpegURL = null;
  $('encoded-preview').removeAttribute('src');
  $('download').removeAttribute('href');
  $('jpeg-download').hidden = true;
  status('encode-status', '');
  status('jpeg-status', '');
}
const payloadInstructions = {
  card: {
    label: 'Contact card text',
    help: 'Paste complete lxma://, RSCP1 or RSCP2 text, or use the QR chooser above.',
    placeholder: 'Paste your complete contact card',
  },
  paper: {
    label: 'Paper message link',
    help: 'In Ratspeak, open the paper message’s menu → Copy paper link. Paste it here, or choose its saved QR above. The recipient reads it in Ratspeak.',
    placeholder: 'lxm://…',
  },
  lxmf: {
    label: 'Your LXMF address',
    help: 'In Ratspeak, open your identity and copy the row labeled LXMF Address. Paste its 32-character value here.',
    placeholder: 'Paste your LXMF address',
  },
  identity: {
    label: 'Your identity hash',
    help: 'In Ratspeak, open your identity and copy the row labeled Identity Hash. Its 32-character value will be converted to an LXMF address.',
    placeholder: 'Paste your identity hash',
  },
};
for (const radio of document.querySelectorAll('[name="payload-type"]'))
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    if (payloadType) contactDrafts[payloadType] = $('contact').value;
    payloadType = radio.value;
    clearEncoded();
    const instructions = payloadInstructions[payloadType];
    $('encode-inputs').hidden = false;
    for (const id of ['contact', 'encode-file', 'encode-file-paste', 'encode-password', 'encode-button'])
      $(id).disabled = false;
    $('contact-label').textContent = instructions.label;
    $('contact-help').textContent = instructions.help;
    $('contact').placeholder = instructions.placeholder;
    $('contact').rows = ['card', 'paper'].includes(payloadType) ? 3 : 2;
    $('contact').value = contactDrafts[payloadType];
    $('contact-format').hidden = true;
    const isPaper = payloadType === 'paper',
      hasQr = isPaper || payloadType === 'card';
    $('contact-qr-input').hidden = !hasQr;
    $('contact-qr').disabled = !hasQr;
    $('contact-qr-paste').disabled = !hasQr;
    $('contact-qr').value = '';
    $('contact-qr-label').textContent = isPaper
      ? 'Choose your paper-message QR'
      : 'Choose your contact QR';
    $('contact-qr-help').textContent = isPaper
      ? 'In Ratspeak, save the QR for an existing paper message. Its encrypted link is read locally.'
      : 'In Ratspeak: open your identity → Share Contact Card → Share QR. The normal and Legacy formats both work.';
    $('contact-qr-input').setAttribute(
      'aria-label',
      isPaper ? 'Load an encrypted paper message' : 'Load a full contact card',
    );
    $('paper-protection-help').hidden = !isPaper;
    $('password-empty-help').textContent = isPaper
      ? 'Leave empty to let anyone recover the paper link. The message remains encrypted for its intended recipient. A forgotten Packrat password cannot be reset.'
      : 'Leave empty to let anyone read the hidden contact. Forgotten passwords cannot be reset.';
    $('encode-file-help').textContent = isPaper
      ? 'JPG or PNG, up to 20 MB. Longer links need larger pictures in photo mode. Sending the original PNG as a file avoids resizing by photo-sharing apps.'
      : 'JPG or PNG, up to 20 MB. The image is read only on your device.';
    status(
      'contact-qr-status',
      payloadType === 'paper'
        ? 'The paper link is read on your device and filled in below.'
        : 'The QR is read on your device and its contact text is filled in below.',
    );
  });
function syncPhotoQuality() {
  $('photo-quality-field').hidden = !$('method-jpeg').checked;
  $('photo-quality-value').value = photoQuality() + '%';
}
for (const radio of document.querySelectorAll('[name="image-method"]'))
  radio.addEventListener('change', () => {
    clearEncoded();
    syncPhotoQuality();
  });
$('photo-quality').addEventListener('input', () => {
  syncPhotoQuality();
  clearEncoded();
});
syncPhotoQuality();
for (const id of ['encode-file', 'contact', 'encode-password'])
  $(id).addEventListener('input', clearEncoded);
$('contact').addEventListener('input', () => {
  if (payloadType) contactDrafts[payloadType] = $('contact').value;
  const card = payloadType === 'card' && /^(lxma:\/\/|RSCP[12]:)/i.test($('contact').value.trim());
  const paper = payloadType === 'paper' && /^lxm:\/\//i.test($('contact').value.trim());
  $('contact-format').hidden = !(card || paper);
  $('contact-format').textContent = paper
    ? 'Paper link recognized. Ratspeak handles message decryption and sender verification.'
    : card
      ? 'Contact card recognized. Its public key will be included.'
      : '';
  status(
    'contact-qr-status',
    payloadType === 'paper'
      ? 'The paper link is read on your device and filled in below.'
      : 'The QR is read on your device and its contact text is filled in below.',
  );
});
function validatePayload(text, type) {
  try {
    if (type === 'paper') parsePaperUri(text);
    else if (type !== 'card') parseHash(text);
  } catch (error) {
    if (type === 'paper') throw error;
    if (type === 'card')
      throw new Error(
        'Choose a saved Ratspeak contact QR, or paste a full contact card including its public key.',
      );
    if (type === 'identity')
      throw new Error(
        'Copy the 32-character Identity Hash from your identity in Ratspeak and paste it here.',
      );
    throw new Error(
      'Copy the 32-character LXMF Address from your identity in Ratspeak and paste it here.',
    );
  }
}
$('contact-qr').onchange = async () => {
  const file = $('contact-qr').files[0];
  if (!file || !['card', 'paper'].includes(payloadType)) return;
  clearEncoded();
  const revision = encodeRevision;
  const type = payloadType;
  status(
    'contact-qr-status',
    type === 'paper' ? 'Reading paper-message QR…' : 'Reading contact QR…',
  );
  try {
    const { canvas } = await loadImage(file);
    const found = await readContactQr(canvas);
    if (!found) throw new Error('No QR code found. Choose the QR image saved by Ratspeak.');
    const contact =
      type === 'paper' ? parsePaperUri(found).text : (await parseContactCard(found)).text;
    if (revision !== encodeRevision) return;
    $('contact').value = contact;
    $('contact').dispatchEvent(new Event('input'));
    status(
      'contact-qr-status',
      type === 'paper'
        ? 'Encrypted paper link loaded.'
        : 'Full contact card loaded, including its public key.',
    );
  } catch (err) {
    if (revision === encodeRevision) status('contact-qr-status', err.message, 'error');
  }
};
function clearDecoded() {
  decodeRevision++;
  pending = null;
  $('decode-result').hidden = true;
  $('unlock-form').hidden = true;
  $('recovered-contact').value = '';
  $('decode-password').value = '';
  $('open-contact').removeAttribute('href');
  $('decoded-parts').replaceChildren();
  const ctx = $('qr').getContext('2d');
  ctx.clearRect(0, 0, $('qr').width, $('qr').height);
  status('decode-status', '');
  status('copy-status', '');
}
$('decode-file').onchange = clearDecoded;
async function loadImage(file, forEncoding = false, packetSize = 0, method = 'subtle') {
  if (!file) throw new Error('Choose a JPG or PNG image first.');
  if (!['image/png', 'image/jpeg'].includes(file.type))
    throw new Error('Choose a JPG or PNG image.');
  if (file.size > 20 * 1024 * 1024)
    throw new Error('This image is over 20 MB. Choose a smaller file.');
  const url = URL.createObjectURL(file),
    image = new Image();
  try {
    image.src = url;
    await image.decode();
    let width = image.naturalWidth,
      height = image.naturalHeight;
    if (width * height > 24000000 || width > 10000 || height > 10000)
      throw new Error('Choose an image under 24 megapixels and 10,000 pixels per side.');
    if (forEncoding && method !== 'subtle') {
      const needed = requiredBlocks(packetSize);
      const factor = Math.max(1, Math.sqrt(((needed + 200) * 64) / (width * height)));
      width = Math.ceil((width * factor) / 8) * 8;
      height = Math.ceil((height * factor) / 8) * 8;
      if (width * height > 24000000 || width > 10000 || height > 10000)
        throw new Error(
          'This image is too narrow to carry this data. Choose a less extreme aspect ratio.',
        );
      if (width !== image.naturalWidth || height !== image.naturalHeight) {
        const prior = document.createElement('canvas');
        prior.width = image.naturalWidth;
        prior.height = image.naturalHeight;
        const check = prior.getContext('2d', { willReadFrequently: true });
        check.fillStyle = '#fff';
        check.fillRect(0, 0, prior.width, prior.height);
        check.drawImage(image, 0, 0);
        let alreadyEncoded = false;
        try {
          extract(check.getImageData(0, 0, prior.width, prior.height));
          alreadyEncoded = true;
        } catch {}
        if (alreadyEncoded)
          throw new Error(
            'This image already contains hidden data. Choose the original clean image so its old marks are not kept.',
          );
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    return {
      canvas,
      pixels: ctx.getImageData(0, 0, width, height),
      originalWidth: image.naturalWidth,
      originalHeight: image.naturalHeight,
    };
  } catch (e) {
    if (e.name === 'EncodingError')
      throw new Error('This image could not be read. Choose a valid JPG or PNG.');
    throw e;
  } finally {
    URL.revokeObjectURL(url);
  }
}
function blobFor(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(new Error('The browser could not export this image. Try a smaller image.')),
      type,
      quality,
    ),
  );
}
// Export in the first format that reloads with the exact packet intact.
// Name downloads by content hash so the filename does not reveal the tool.
async function hashName(blob) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  const hex = Array.from(digest.subarray(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex}.${blob.type === 'image/jpeg' ? 'jpg' : 'png'}`;
}
async function exportVerified(canvas, packet, attempts) {
  for (const [type, quality] of attempts) {
    const blob = await blobFor(canvas, type, quality);
    if (blob.type !== type) continue; // Browser substituted another format.
    const { pixels } = await loadImage(new File([blob], 'check', { type }));
    try {
      const found = extract(pixels);
      if (found.data.length === packet.length && found.data.every((b, i) => b === packet[i]))
        return { blob, found, quality };
    } catch {}
  }
  throw new Error('The image did not pass its round-trip check. Try another image.');
}
$('encode-form').onsubmit = async (e) => {
  e.preventDefault();
  if (!payloadType) return;
  clearEncoded();
  const revision = encodeRevision,
    type = payloadType,
    method = document.querySelector('[name="image-method"]:checked').value,
    chosenQuality = photoQuality();
  const button = $('encode-button');
  button.disabled = true;
  status('encode-status', type === 'paper' ? 'Embedding paper link…' : 'Embedding contact…');
  try {
    await tick();
    const text =
      type === 'paper'
        ? parsePaperUri($('contact').value).text
        : type === 'card'
          ? (await parseContactCard($('contact').value)).text
          : $('contact').value;
    validatePayload(text, type);
    const packet = await makePacket(
      text,
      $('encode-password').value,
      type === 'identity' ? 'identity' : 'lxmf',
    );
    const { canvas, pixels, originalWidth, originalHeight } = await loadImage(
      $('encode-file').files[0],
      true,
      packet.length,
      method,
    );
    let alreadyEncoded = false;
    try {
      extract(pixels);
      alreadyEncoded = true;
    } catch {}
    if (alreadyEncoded)
      throw new Error(
        'This image already contains hidden data. Choose the original clean image so its old marks are not kept.',
      );
    embed(pixels, packet, method);
    canvas.getContext('2d').putImageData(pixels, 0, 0);
    // Verify the exact exported file after reload, not only the in-memory pixels.
    const { blob, found, quality } = await exportVerified(
      canvas,
      packet,
      method === 'subtle' ? [['image/png']] : photoExports(chosenQuality),
    );
    const filename = await hashName(blob);
    if (revision !== encodeRevision) return;
    const isJpeg = blob.type === 'image/jpeg';
    encodedCanvas = canvas;
    encodedBlob = blob;
    encodedURL = URL.createObjectURL(blob);
    $('encoded-preview').src = encodedURL;
    $('download').href = encodedURL;
    $('download').download = filename;
    $('encode-result').hidden = false;
    const resized = canvas.width !== originalWidth || canvas.height !== originalHeight;
    $('encoded-info').textContent =
      `${canvas.width} × ${canvas.height} · ${isJpeg ? `JPEG ${Math.round(quality * 100)}%${Math.round(quality * 100) > chosenQuality ? ` (raised from ${chosenQuality}%)` : ''}` : method === 'subtle' ? 'PNG' : 'PNG (JPEG did not keep the data)'} · ${Math.round(blob.size / 1024)} KB · ${packet[5] ? 'Packrat password protected' : found.kind === 'paper' ? 'Recipient-encrypted paper message' : 'Unprotected'} · ${found.kind === 'paper' ? 'Paper message' : found.kind === 'card' ? 'Full contact card' : found.kind === 'identity' ? 'Identity hash' : 'LXMF address'} · ${method === 'subtle' ? 'Original PNG file' : 'Photo mode (experimental)'}${resized ? ' · Dimensions adjusted to the 8-pixel block grid' : ''}`;
    status('encode-status', 'Ready to share. Download your image below.', 'success');
  } catch (err) {
    if (revision === encodeRevision) status('encode-status', err.message, 'error');
  } finally {
    button.disabled = false;
  }
};
async function copyField(value, input) {
  try {
    await navigator.clipboard.writeText(value);
    status('copy-status', 'Copied.');
    return true;
  } catch {
    input.focus();
    input.select();
    status(
      'copy-status',
      'Copy was blocked. The value is selected; use your browser’s Copy command.',
    );
    return false;
  }
}
function renderParts(details, identity, customFields = null) {
  const container = $('decoded-parts');
  container.replaceChildren();
  const fields =
    customFields ??
    (details
      ? [
          ...(details.name ? [['name', 'Name', details.name]] : []),
          ['address', 'LXMF address', details.address],
          ['identity', 'Identity hash', details.identity],
          ['public-key', 'Public key', details.publicKey],
          ...(details.format === 'RSCP2'
            ? [
                ['kind', 'Contact type', details.kind],
                ...(details.caps.length
                  ? [['capabilities', 'Capabilities', details.caps.join(',')]]
                  : []),
              ]
            : []),
        ]
      : identity
        ? [['identity', 'Identity hash', identity]]
        : []);
  for (const [key, label, value] of fields) {
    const group = document.createElement('div');
    group.className = 'contact-part';
    const title = document.createElement('label');
    title.htmlFor = 'part-' + key;
    title.textContent = label;
    const row = document.createElement('div');
    row.className = 'part-value';
    const input = document.createElement('textarea');
    input.id = 'part-' + key;
    input.readOnly = true;
    input.rows = value.length > 90 ? 3 : 1;
    input.value = value;
    input.spellcheck = false;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', 'Copy ' + label.toLowerCase());
    button.onclick = async () => {
      if (await copyField(value, input)) {
        button.textContent = 'Copied';
        setTimeout(() => (button.textContent = 'Copy'), 1500);
      }
    };
    row.append(input, button);
    group.append(title, row);
    container.append(group);
  }
}
function fitPartFields() {
  for (const input of document.querySelectorAll('#decoded-parts textarea')) {
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
  }
}
window.addEventListener('resize', fitPartFields);
function drawQr(text, paper) {
  const make = (level) => {
    const code = qrcode(0, level);
    code.addData(text, 'Byte');
    code.make();
    return code;
  };
  let code;
  try {
    code = make('M');
  } catch (error) {
    if (!paper) throw error;
    code = make('L');
  }
  const count = code.getModuleCount(),
    scale = 6,
    quiet = 4,
    canvas = $('qr');
  canvas.width = canvas.height = (count + quiet * 2) * scale;
  canvas.setAttribute(
    'aria-label',
    paper
      ? 'QR code of the encrypted paper-message link'
      : 'QR code of the recovered Ratspeak contact',
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'black';
  for (let y = 0; y < count; y++)
    for (let x = 0; x < count; x++)
      if (code.isDark(y, x)) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
  $('qr-help').textContent = paper
    ? 'Scan in Ratspeak using the recipient’s identity to read the message.'
    : 'Scan in Ratspeak to import this contact.';
}
async function showPaper(text, revision, source) {
  const paper = parsePaperUri(text);
  if (revision !== decodeRevision) return;
  renderParts(null, null, [['recipient-address', 'Recipient LXMF address', paper.destination]]);
  $('recovered-heading').textContent = 'Paper link recovered';
  $('recovered-label').textContent = 'Encrypted paper message link';
  $('recovered-contact').value = paper.text;
  $('recovered-contact').rows = 4;
  $('copy-contact').textContent = 'Copy paper link';
  $('open-contact').hidden = false;
  $('open-contact').href = paper.text;
  $('contact-qr-result').hidden = false;
  drawQr(paper.text, true);
  $('contact-import-help').textContent =
    'Use the intended recipient’s identity in Ratspeak. If the button does not open it, copy the link: enable Settings → General → Paper messages, then Messages → New conversation (pencil) → Paper. Paste the link → Review → Add to chat. Ratspeak decrypts and checks the sender; Packrat cannot read or authenticate the message.';
  $('unlock-form').hidden = true;
  $('decode-password').value = '';
  $('decode-result').hidden = false;
  requestAnimationFrame(fitPartFields);
  status(
    'decode-status',
    source === 'qr'
      ? 'Encrypted paper link read from QR.'
      : 'Paper link recovered. Open it in Ratspeak to read the message.',
    'success',
  );
}
async function showContact(contact, revision, kind = 'card', source = 'hidden') {
  if (/^lxm:\/\//i.test(contact)) return showPaper(contact, revision, source);
  const fullCard = /^(lxma:\/\/|RSCP[12]:)/i.test(contact);
  const details = fullCard ? await parseContactCard(contact) : null;
  const identity = kind === 'identity' ? contact : null;
  const address = identity ? await lxmfFromIdentity(identity) : contact;
  const recovered = fullCard
    ? details.format === 'lxma'
      ? await toRatspeakContactCard(details.legacy)
      : details.text
    : address;
  if (revision !== decodeRevision) return;
  renderParts(details, identity);
  $('recovered-heading').textContent = fullCard ? 'Contact recovered' : 'LXMF address recovered';
  $('recovered-label').textContent = fullCard ? 'Complete contact card' : 'LXMF address';
  $('recovered-contact').value = recovered;
  $('recovered-contact').rows = fullCard ? 4 : 2;
  $('open-contact').hidden = !fullCard || details.kind !== 'person' || details.caps.length > 0;
  $('contact-qr-result').hidden = !fullCard;
  $('copy-contact').textContent = fullCard ? 'Copy complete card' : 'Copy address';
  $('contact-import-help').textContent = fullCard
    ? 'Copy any field separately, or scan the QR to import the complete contact.'
    : 'In Ratspeak, choose Add Contact → Address and paste this address. Before you can send encrypted messages, Ratspeak needs to discover this person’s encryption details on the network. If it hasn’t found them yet, you may have to wait.';
  if (fullCard) {
    $('open-contact').href = details.legacy;
    drawQr(recovered, false);
  } else $('open-contact').removeAttribute('href');
  $('unlock-form').hidden = true;
  $('decode-password').value = '';
  $('decode-result').hidden = false;
  requestAnimationFrame(fitPartFields);
  status(
    'decode-status',
    source === 'qr'
      ? 'Contact read from QR.'
      : fullCard
        ? 'Contact recovered. Copy it or scan the QR code to import.'
        : 'Address recovered. Copy it into Ratspeak’s Add Contact → Address.',
    'success',
  );
}
async function decodeFile(file) {
  clearDecoded();
  const revision = decodeRevision;
  $('decode-button').disabled = true;
  status('decode-status', 'Looking for a contact or paper message…');
  try {
    await tick();
    const { canvas, pixels } = await loadImage(file);
    let found;
    try {
      found = extract(pixels);
    } catch (hiddenError) {
      const raw = await readContactQr(canvas);
      if (revision !== decodeRevision) return;
      if (raw) {
        const paper = /^lxm:\/\//i.test(raw);
        const value = paper ? parsePaperUri(raw).text : (await parseContactCard(raw)).text;
        await showContact(value, revision, paper ? 'paper' : 'card', 'qr');
        return;
      }
      throw hiddenError;
    }
    if (revision !== decodeRevision) return;
    pending = found.data;
    if (found.encrypted) {
      $('unlock-form').hidden = false;
      status(
        'decode-status',
        found.kind === 'paper'
          ? 'Paper link found. Enter its Packrat password to recover the link.'
          : 'Hidden contact found. Enter its password to unlock it.',
      );
      $('decode-password').focus();
    } else await showContact(await openPacket(pending), revision, found.kind);
  } catch (err) {
    if (revision === decodeRevision) status('decode-status', err.message, 'error');
  } finally {
    $('decode-button').disabled = false;
  }
}
$('decode-form').onsubmit = (e) => {
  e.preventDefault();
  decodeFile($('decode-file').files[0]);
};
$('try-decode').onclick = () => {
  if (!encodedBlob) return;
  const file = new File([encodedBlob], $('download').download, { type: encodedBlob.type });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  $('decode-file').files = transfer.files;
  tab('decode');
  decodeFile(file);
};
$('unlock-form').onsubmit = async (e) => {
  e.preventDefault();
  const revision = decodeRevision;
  $('unlock-button').disabled = true;
  status('decode-status', 'Unlocking hidden data…');
  try {
    const contact = await openPacket(pending, $('decode-password').value);
    if (revision === decodeRevision)
      await showContact(contact, revision, inspectPacket(pending).kind);
  } catch (err) {
    if (revision === decodeRevision) status('decode-status', err.message, 'error');
  } finally {
    $('unlock-button').disabled = false;
  }
};
$('copy-contact').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('recovered-contact').value);
    status(
      'copy-status',
      /^lxm:\/\//i.test($('recovered-contact').value)
        ? 'Paper link copied.'
        : /^(lxma:\/\/|RSCP[12]:)/i.test($('recovered-contact').value)
          ? 'Contact copied.'
          : 'Address copied.',
    );
  } catch {
    $('recovered-contact').focus();
    $('recovered-contact').select();
    status(
      'copy-status',
      'Copy was blocked. The contact is selected; use your browser’s Copy command.',
    );
  }
};
$('jpeg-quality').oninput = () => {
  $('quality-value').value = $('jpeg-quality').value + '%';
};
$('test-jpeg').onclick = async () => {
  if (!encodedCanvas) return;
  const revision = encodeRevision,
    canvas = encodedCanvas,
    expected = extract(
      canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height),
    ).data;
  $('test-jpeg').disabled = true;
  status('jpeg-status', 'Recompressing and checking hidden data…');
  try {
    await tick();
    const quality = Number($('jpeg-quality').value),
      blob = await blobFor(canvas, 'image/jpeg', quality / 100),
      filename = await hashName(blob);
    if (revision !== encodeRevision) return;
    if (jpegURL) URL.revokeObjectURL(jpegURL);
    jpegURL = URL.createObjectURL(blob);
    $('jpeg-download').href = jpegURL;
    $('jpeg-download').download = filename;
    $('jpeg-download').hidden = false;
    const { pixels } = await loadImage(new File([blob], 'test.jpg', { type: 'image/jpeg' })),
      found = extract(pixels);
    if (found.data.length !== expected.length || !found.data.every((b, i) => b === expected[i]))
      throw new Error('The recovered packet differs from the original.');
    if (revision === encodeRevision)
      status(
        'jpeg-status',
        `Passed at ${quality}% JPEG quality: the complete hidden payload survived (${found.corrected} Hamming corrections). Test the downloaded JPEG on another device next.`,
        'success',
      );
  } catch (err) {
    if (revision === encodeRevision)
      status('jpeg-status', `JPEG test failed: ${err.message}`, 'error');
  } finally {
    $('test-jpeg').disabled = false;
  }
};
$('clear-session').onclick = () => {
  clearEncoded();
  clearDecoded();
  $('encode-form').reset();
  $('decode-form').reset();
  $('unlock-form').reset();
  payloadType = null;
  for (const key of Object.keys(contactDrafts)) contactDrafts[key] = '';
  $('encode-inputs').hidden = true;
  for (const id of ['contact', 'encode-file', 'encode-file-paste', 'encode-password', 'encode-button'])
    $(id).disabled = true;
  $('contact-qr-paste').disabled = true;
  syncPhotoQuality();
  $('contact-format').hidden = true;
  status('contact-qr-status', '');
  tab('encode');
  $('payload-card').focus();
};
// Clipboard paste, alongside the normal file choosers. Images stay local.
const pasteShortcut = /Mac|iPhone|iPad/.test(
  navigator.userAgentData?.platform || navigator.platform || '',
)
  ? '⌘V'
  : 'Ctrl+V';
const pasteStatus = {
  'contact-qr': 'contact-qr-status',
  'encode-file': 'encode-status',
  'decode-file': 'decode-status',
};
async function asPastedFile(blob) {
  if (blob.type === 'image/png' || blob.type === 'image/jpeg')
    return new File([blob], blob.type === 'image/jpeg' ? 'pasted-image.jpg' : 'pasted-image.png', {
      type: blob.type,
    });
  // Other clipboard formats (WebP, GIF, BMP) are converted to lossless PNG.
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error('The pasted image could not be read. Copy a JPG or PNG image.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return new File([await blobFor(canvas)], 'pasted-image.png', { type: 'image/png' });
}
async function placePastedImage(target, blob) {
  const input = $(target);
  if (input.disabled) return;
  const file = await asPastedFile(blob);
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  // Same events as choosing a file, so the existing handlers run unchanged.
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  if (target !== 'contact-qr') status(pasteStatus[target], 'Image pasted from the clipboard.');
}
async function clipboardImage() {
  if (!navigator.clipboard?.read)
    throw new Error(
      `This browser cannot paste images with a button. Press ${pasteShortcut} instead.`,
    );
  let items;
  try {
    items = await navigator.clipboard.read();
  } catch {
    throw new Error(`Clipboard access was blocked. Press ${pasteShortcut} to paste instead.`);
  }
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'));
    if (type) return item.getType(type);
  }
  throw new Error('There is no image on the clipboard. Copy an image first.');
}
for (const button of document.querySelectorAll('[data-paste-target]'))
  button.addEventListener('click', async () => {
    const target = button.dataset.pasteTarget;
    try {
      await placePastedImage(target, await clipboardImage());
    } catch (err) {
      status(pasteStatus[target], err.message, 'error');
    }
  });
// Ctrl/⌘+V: a focused chooser or Paste button wins. Otherwise Decode gets the
// decode image; Encode sends a readable QR to the QR chooser while the contact
// is still empty, and anything else to the picture.
async function pasteTarget(blob) {
  const active = document.activeElement;
  const focused = active?.dataset?.pasteTarget || (active?.type === 'file' ? active.id : null);
  if (focused && pasteStatus[focused]) return focused;
  if (!$('decode-panel').hidden) return 'decode-file';
  if (!payloadType) {
    status('encode-status', 'Choose what to encode first, then paste the picture.', 'error');
    return null;
  }
  if (!$('contact-qr-input').hidden && !$('contact').value.trim()) {
    try {
      const { canvas } = await loadImage(await asPastedFile(blob));
      if (await readContactQr(canvas)) return 'contact-qr';
    } catch {}
  }
  return 'encode-file';
}
document.addEventListener('paste', async (event) => {
  const item = [...(event.clipboardData?.items || [])].find(
    (i) => i.kind === 'file' && i.type.startsWith('image/'),
  );
  if (!item) return; // Ordinary text paste.
  const active = document.activeElement;
  const typing =
    active?.tagName === 'TEXTAREA' || (active?.tagName === 'INPUT' && active.type !== 'file');
  if (typing && event.clipboardData.types.includes('text/plain')) return;
  event.preventDefault();
  const blob = item.getAsFile();
  if (!blob) return;
  const target = await pasteTarget(blob);
  if (!target) return;
  try {
    await placePastedImage(target, blob);
  } catch (err) {
    status(pasteStatus[target], err.message, 'error');
  }
});
if ($('app-version').textContent === '__APP_VERSION__')
  $('app-version').textContent = 'Development preview';

const offlineLink = $('offline-download');
if (offlineLink)
  offlineLink.addEventListener('click', async (event) => {
    event.preventDefault();
    if (offlineLink.getAttribute('aria-disabled') === 'true') return;
    offlineLink.setAttribute('aria-disabled', 'true');
    status('offline-status', 'Preparing the offline app…');
    try {
      // Load a static same-origin module on request. No connection API or user data is involved.
      // A local blob improves reliability when browsers restrict direct downloads.
      const { offlineHtml } = await import(new URL('offline-download.js', document.baseURI).href);
      const url = URL.createObjectURL(new Blob([offlineHtml], { type: 'text/html;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'packrat-offline.html';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      status(
        'offline-status',
        'Download started. Open the saved HTML file in your browser to use Packrat offline.',
      );
    } catch {
      status(
        'offline-status',
        'Could not prepare the offline download. Check your connection and try again.',
        'error',
      );
    } finally {
      offlineLink.removeAttribute('aria-disabled');
    }
  });
