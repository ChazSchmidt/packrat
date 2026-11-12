import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { createStaticServer, root } from '../../scripts/dev.mjs';
import { contact } from '../contact-fixture.mjs';
import { paperUri, paperDestination } from '../paper-fixture.mjs';
import {
  parseContactCard,
  toRatspeakContactCard,
  normalizeContactCard,
} from '../../public/contact-card.js';
import jsQR from '../jsQR.cjs';
const out = path.join(root, 'tests/results');
await mkdir(out, { recursive: true });
const server = createStaticServer({
  directory: path.join(root, 'dist'),
  prefix: '/test-repository/',
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/test-repository/`;
const options = {
  channel: process.env.CHROME_CHANNEL || 'chrome',
  headless: true,
  chromiumSandbox: true,
};
if (process.env.CHROME_PATH) {
  options.executablePath = process.env.CHROME_PATH;
  delete options.channel;
}
let browser;
try {
  browser = await chromium.launch(options);
  const context = await browser.newContext({
    viewport: { width: 1200, height: 980 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage(),
    errors = [],
    requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
  });
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method() }));
  await page.goto(base);
  assert.equal(await page.evaluate(() => !!crypto.subtle), true);
  assert.equal(await page.locator('#encode-inputs').isVisible(), false);
  assert.equal(await page.locator('[name="payload-type"]').count(), 4);
  assert.equal((await fetch(base + '../package.json')).status, 404);
  assert.equal((await fetch(base + 'app.js', { method: 'POST', body: 'unused' })).status, 405);
  const png = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 1200;
      c.height = 960;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 1200, 960);
      g.addColorStop(0, '#375452');
      g.addColorStop(1, '#D5945E');
      x.fillStyle = g;
      x.fillRect(0, 0, 1200, 960);
      x.fillStyle = '#FAE0B6';
      x.beginPath();
      x.arc(650, 480, 220, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = '#375452';
      x.font = 'bold 50px sans-serif';
      x.fillText('A picture with a contact', 210, 810);
      return c.toDataURL().split(',')[1];
    }),
    'base64',
  );
  const image = { name: 'test-picture.png', mimeType: 'image/png', buffer: png };
  const details = await parseContactCard(contact),
    native = await toRatspeakContactCard(contact);
  const fields = native.split(':');
  fields[1] = Buffer.from('Test contact <script>').toString('base64url');
  const rscp1 = fields.join(':'),
    rscp2 = 'RSCP2:device:' + fields.slice(1).join(':') + ':rsnode,rsnode.update';
  async function encode(type, text, method = 'jpeg', password = '') {
    await page.locator('#encode-tab').click();
    await page.locator('#payload-' + type).check();
    await page.locator('#contact').fill(text);
    await page.locator('#method-' + method).check();
    await page.locator('#encode-file').setInputFiles(image);
    await page.locator('#encode-password').fill(password);
    await page.locator('#encode-button').click();
    await page.waitForFunction(
      () =>
        !document.querySelector('#encode-result').hidden ||
        document.querySelector('#encode-status').dataset.kind === 'error',
    );
    assert.equal(
      await page.locator('#encode-result').isVisible(),
      true,
      await page.locator('#encode-status').innerText(),
    );
    assert.match(
      await page.locator('#encoded-info').innerText(),
      method === 'subtle' ? / · PNG · / : / · JPEG \d+% · /,
    );
  }
  async function reveal(password = '') {
    await page.locator('#try-decode').click();
    if (password) {
      await page.locator('#unlock-form').waitFor();
      await page.locator('#decode-password').fill('wrong passphrase');
      await page.locator('#unlock-button').click();
      await page.waitForFunction(
        () => document.querySelector('#decode-status').dataset.kind === 'error',
      );
      assert.equal(await page.locator('#decode-result').isVisible(), false);
      await page.locator('#decode-password').fill(password);
      await page.locator('#unlock-button').click();
    }
    await page.locator('#decode-result').waitFor();
    return page.locator('#recovered-contact').inputValue();
  }
  for (const method of ['subtle', 'jpeg'])
    for (const card of [contact, rscp1, rscp2]) {
      await encode('card', card, method, card === rscp2 ? 'long browser test passphrase' : '');
      const recovered = await reveal(card === rscp2 ? 'long browser test passphrase' : '');
      assert.equal(await normalizeContactCard(recovered), contact);
      if (card !== contact) assert.equal(recovered, card);
      assert.equal(await page.locator('#part-identity').inputValue(), details.identity);
      assert.equal(await page.locator('#part-public-key').inputValue(), details.publicKey);
    }
  for (const [type, value] of [
    ['lxmf', details.address],
    ['identity', details.identity],
  ]) {
    await encode(type, value, 'subtle', 'hash test passphrase');
    assert.equal(await reveal('hash test passphrase'), details.address);
    if (type === 'identity')
      assert.equal(await page.locator('#part-identity').inputValue(), details.identity);
    assert.equal(await page.locator('#contact-qr-result').isVisible(), false);
  }
  // Paper links stay recipient-encrypted; Packrat recovers the exact URI and destination.
  for (const method of ['subtle', 'jpeg'])
    for (const password of ['', 'paper browser passphrase']) {
      await encode('paper', paperUri, method, password);
      if (method === 'jpeg' && password) {
        await page.locator('#experiment').evaluate((e) => (e.open = true));
        await page.locator('#test-jpeg').click();
        await page.waitForFunction(() => !document.querySelector('#test-jpeg').disabled);
        assert.match(await page.locator('#jpeg-status').innerText(), /Passed at 80%/);
      }
      assert.equal(await reveal(password), paperUri);
      assert.equal(await page.locator('#part-recipient-address').inputValue(), paperDestination);
      assert.equal(await page.locator('#open-contact').getAttribute('href'), paperUri);
      assert.match(
        await page.locator('#contact-import-help').innerText(),
        /cannot read or authenticate/,
      );
      const pixels = await page.locator('#qr').evaluate((c) => ({
        data: Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data),
        width: c.width,
        height: c.height,
      }));
      assert.equal(
        jsQR(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height).data,
        paperUri,
      );
    }
  await page.locator('#copy-contact').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), paperUri);
  await page.getByRole('button', { name: 'Copy recipient lxmf address', exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), paperDestination);
  const paperQr = {
    name: 'paper-qr.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      await page.locator('#qr').evaluate((c) => c.toDataURL().split(',')[1]),
      'base64',
    ),
  };
  await page.locator('#encode-tab').click();
  await page.locator('#payload-paper').check();
  await page.locator('#contact-qr').setInputFiles(paperQr);
  await page.waitForFunction(() =>
    document
      .querySelector('#contact-qr-status')
      .textContent.includes('Encrypted paper link loaded'),
  );
  assert.equal(await page.locator('#contact').inputValue(), paperUri);
  await page.locator('#decode-tab').click();
  await page.locator('#decode-file').setInputFiles(paperQr);
  await page.locator('#decode-button').click();
  await page.locator('#decode-result').waitFor();
  assert.equal(await page.locator('#recovered-contact').inputValue(), paperUri);
  // Largest structural paper URI needs QR level L; a normal QR input exercises the fallback.
  const largest = 'lxm://' + Buffer.alloc(2210).toString('base64url');
  const largestQr = Buffer.from(
    await page.evaluate((text) => {
      const code = qrcode(0, 'L');
      code.addData(text, 'Byte');
      code.make();
      const n = code.getModuleCount(),
        c = document.createElement('canvas');
      c.width = c.height = (n + 8) * 6;
      const x = c.getContext('2d');
      x.fillStyle = 'white';
      x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = 'black';
      for (let y = 0; y < n; y++)
        for (let z = 0; z < n; z++)
          if (code.isDark(y, z)) x.fillRect((z + 4) * 6, (y + 4) * 6, 6, 6);
      return c.toDataURL().split(',')[1];
    }, largest),
    'base64',
  );
  await page
    .locator('#decode-file')
    .setInputFiles({ name: 'large-paper.png', mimeType: 'image/png', buffer: largestQr });
  await page.locator('#decode-button').click();
  await page.locator('#decode-result').waitFor();
  assert.equal(await page.locator('#recovered-contact').inputValue(), largest);
  // Exported bytes are recovered in a separate Chrome process.
  await encode('card', rscp1, 'jpeg');
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#download').click(),
  ]);
  const encoded = path.join(out, 'portable-contact.jpg');
  await download[0].saveAs(encoded);
  // The filename is the first 16 hex characters of the file's SHA-256.
  assert.equal(
    download[0].suggestedFilename(),
    `${createHash('sha256').update(await readFile(encoded)).digest('hex').slice(0, 16)}.jpg`,
  );
  const second = await chromium.launch(options);
  try {
    const p = await second.newPage();
    await p.goto(base);
    await p.locator('#decode-tab').click();
    await p.locator('#decode-file').setInputFiles(encoded);
    await p.locator('#decode-button').click();
    await p.locator('#decode-result').waitFor();
    assert.equal(await p.locator('#recovered-contact').inputValue(), rscp1);
  } finally {
    await second.close();
  }
  await page.locator('#experiment').evaluate((e) => (e.open = true));
  await page.locator('#test-jpeg').click();
  await page.waitForFunction(() => !document.querySelector('#test-jpeg').disabled);
  assert.match(await page.locator('#jpeg-status').innerText(), /Passed at 80%/);
  await reveal();
  const qr = await page.locator('#qr').evaluate((c) => ({
    data: Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data),
    width: c.width,
    height: c.height,
  }));
  assert.equal(jsQR(new Uint8ClampedArray(qr.data), qr.width, qr.height).data, rscp1);
  for (const [key, value] of [
    ['identity', details.identity],
    ['address', details.address],
    ['public-key', details.publicKey],
    ['name', 'Test contact <script>'],
  ]) {
    await page
      .getByRole('button', {
        name:
          'Copy ' +
          (key === 'public-key'
            ? 'public key'
            : key === 'address'
              ? 'lxmf address'
              : key === 'identity'
                ? 'identity hash'
                : 'name'),
        exact: true,
      })
      .click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), value);
  }
  // Plain QR decode for each accepted standard; also use a saved QR as Encode input.
  let qrImage;
  for (const card of [contact, rscp1, rscp2]) {
    const bytes = Buffer.from(
      await page.evaluate((text) => {
        const code = qrcode(0, 'M');
        code.addData(text, 'Byte');
        code.make();
        const n = code.getModuleCount(),
          c = document.createElement('canvas');
        c.width = c.height = (n + 8) * 6;
        const x = c.getContext('2d');
        x.fillStyle = 'white';
        x.fillRect(0, 0, c.width, c.height);
        x.fillStyle = 'black';
        for (let y = 0; y < n; y++)
          for (let z = 0; z < n; z++)
            if (code.isDark(y, z)) x.fillRect((z + 4) * 6, (y + 4) * 6, 6, 6);
        return c.toDataURL().split(',')[1];
      }, card),
      'base64',
    );
    qrImage = { name: 'contact-qr.png', mimeType: 'image/png', buffer: bytes };
    await page.locator('#decode-file').setInputFiles(qrImage);
    await page.locator('#decode-button').click();
    await page.locator('#decode-result').waitFor();
    assert.equal(
      await normalizeContactCard(await page.locator('#recovered-contact').inputValue()),
      contact,
    );
  }
  await page.screenshot({ path: path.join(out, 'decode-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  await page.screenshot({ path: path.join(out, 'decode-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#encode-tab').click();
  await page.locator('#payload-card').check();
  await page.locator('#contact-qr').setInputFiles(qrImage);
  await page.waitForFunction(() =>
    document.querySelector('#contact-qr-status').textContent.includes('loaded'),
  );
  assert.equal(await page.locator('#contact').inputValue(), rscp2);
  await page.screenshot({ path: path.join(out, 'encode-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1200, height: 980 });
  await page.screenshot({ path: path.join(out, 'encode-desktop.png'), fullPage: true });
  await page.locator('#contact').fill('not a contact');
  await page.locator('#encode-button').click();
  await page.waitForFunction(
    () => document.querySelector('#encode-status').dataset.kind === 'error',
  );
  await page.locator('#clear-session').click();
  assert.equal(await page.locator('#contact').inputValue(), '');
  assert.equal(await page.locator('#encode-inputs').isVisible(), false);
  // Photo quality defaults to 100%, can be lowered, and is hidden in file mode.
  assert.equal(await page.locator('#photo-quality').inputValue(), '100');
  await encode('card', rscp1, 'jpeg');
  assert.equal(await page.locator('#photo-quality-field').isVisible(), true);
  assert.match(await page.locator('#encoded-info').innerText(), / · JPEG 100% · /);
  // The page CSP blocks fetch, so read the size from the result line.
  const sizeOf = async () =>
    Number((await page.locator('#encoded-info').innerText()).match(/ · (\d+) KB · /)[1]);
  const size100 = await sizeOf();
  await page.locator('#photo-quality').fill('85');
  assert.equal(await page.locator('#photo-quality-value').innerText(), '85%');
  await page.locator('#encode-button').click();
  await page.locator('#encode-result').waitFor();
  assert.match(await page.locator('#encoded-info').innerText(), / · JPEG (85%|\d+% \(raised from 85%\)) · /);
  assert.ok((await sizeOf()) < size100, 'lower quality should make a smaller file');
  await page.locator('#method-subtle').check();
  assert.equal(await page.locator('#photo-quality-field').isVisible(), false);
  await page.locator('#method-jpeg').check();
  await page.locator('#photo-quality').fill('100');
  // Paste buttons sit beside each file chooser and read the clipboard.
  const copyImage = (file) =>
    page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) }),
      ]);
    }, file.buffer.toString('base64'));
  const fileName = (id) => page.locator('#' + id).evaluate((i) => i.files[0]?.name || '');
  await page.locator('#clear-session').click();
  await page.locator('#payload-card').check();
  await copyImage(qrImage);
  await page.locator('#contact-qr-paste').click();
  await page.waitForFunction(() =>
    document.querySelector('#contact-qr-status').textContent.includes('loaded'),
  );
  assert.equal(await page.locator('#contact').inputValue(), rscp2);
  await copyImage(image);
  await page.locator('#encode-file-paste').click();
  await page.waitForFunction(
    () =>
      document.querySelector('#encode-file').files.length === 1 ||
      document.querySelector('#encode-status').dataset.kind === 'error',
  );
  assert.equal(await fileName('encode-file'), 'pasted-image.png');
  await page.locator('#encode-button').click();
  await page.locator('#encode-result').waitFor();
  const [pastedDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#download').click(),
  ]);
  const pastedEncoded = await readFile(await pastedDownload.path());
  // Ctrl/⌘+V with nothing focused: a QR fills the contact, then a picture fills the image.
  const pasteEvent = (file, type = 'image/png') =>
    page.evaluate(
      async ([b64, mime]) => {
        document.activeElement?.blur();
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const data = new DataTransfer();
        data.items.add(new File([bytes], 'clip', { type: mime }));
        document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
      },
      [file.buffer.toString('base64'), type],
    );
  await page.locator('#clear-session').click();
  await page.locator('#payload-card').check();
  await pasteEvent(qrImage);
  await page.waitForFunction(() =>
    document.querySelector('#contact-qr-status').textContent.includes('loaded'),
  );
  assert.equal(await page.locator('#contact').inputValue(), rscp2);
  assert.equal(await fileName('encode-file'), '');
  await pasteEvent(image);
  await page.waitForFunction(() => document.querySelector('#encode-file').files.length === 1);
  assert.equal(await fileName('encode-file'), 'pasted-image.png');
  await page.locator('#decode-tab').click();
  await pasteEvent({ buffer: pastedEncoded }, 'image/jpeg');
  await page.waitForFunction(() => document.querySelector('#decode-file').files.length === 1);
  assert.equal(await fileName('decode-file'), 'pasted-image.jpg');
  await page.locator('#decode-button').click();
  await page.locator('#decode-result').waitFor();
  assert.equal(await page.locator('#recovered-contact').inputValue(), rscp2);
  // Text pastes into fields are left alone.
  await page.locator('#encode-tab').click();
  await page.locator('#contact').focus();
  assert.equal(
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData('text/plain', 'typed');
      const e = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      document.querySelector('#contact').dispatchEvent(e);
      return e.defaultPrevented;
    }),
    false,
  );
  await page.locator('#clear-session').click();
  // Save the actual offline-button download and execute those bytes with network disabled.
  const [offlineDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#offline-download').click(),
  ]);
  const offlinePath = path.join(out, 'offline-button-download.html');
  await offlineDownload.saveAs(offlinePath);
  assert.equal(await offlineDownload.failure(), null);
  const offlineURL = pathToFileURL(offlinePath).href;
  const offlineContext = await browser.newContext({ offline: true });
  const offline = await offlineContext.newPage(),
    offlineRequests = [],
    offlineErrors = [];
  offline.on('request', (r) => offlineRequests.push(r.url()));
  offline.on('pageerror', (e) => offlineErrors.push(e.message));
  offline.on('console', (m) => {
    if (m.type() === 'error') offlineErrors.push(m.text());
  });
  await offline.goto(offlineURL);
  await offline.locator('#payload-card').check();
  await offline.locator('#contact').fill(rscp1);
  await offline.locator('#method-subtle').check();
  await offline.locator('#encode-file').setInputFiles(image);
  await offline.locator('#encode-password').fill('offline passphrase test');
  await offline.locator('#encode-button').click();
  await offline.locator('#encode-result').waitFor();
  await offline.locator('#try-decode').click();
  await offline.locator('#unlock-form').waitFor();
  await offline.locator('#decode-password').fill('offline passphrase test');
  await offline.locator('#unlock-button').click();
  await offline.locator('#decode-result').waitFor();
  assert.equal(await offline.locator('#recovered-contact').inputValue(), rscp1);
  assert.deepEqual(offlineErrors, []);
  assert.equal(
    offlineRequests.every(
      (url) => url.startsWith('data:') || url.startsWith('blob:') || url === offlineURL,
    ),
    true,
  );
  await offline.locator('#encode-tab').click();
  await offline.locator('#payload-paper').check();
  await offline.locator('#contact').fill(paperUri);
  await offline.locator('#encode-file').setInputFiles(image);
  await offline.locator('#encode-button').click();
  await offline.locator('#encode-result').waitFor();
  await offline.locator('#try-decode').click();
  await offline.locator('#unlock-form').waitFor();
  await offline.locator('#decode-password').fill('offline passphrase test');
  await offline.locator('#unlock-button').click();
  await offline.locator('#decode-result').waitFor();
  assert.equal(await offline.locator('#recovered-contact').inputValue(), paperUri);
  assert.deepEqual(offlineErrors, []);
  assert.deepEqual(errors, []);
  assert.equal(
    requests.every(
      (r) => r.method === 'GET' && (r.url.startsWith(base) || r.url.startsWith('blob:')),
    ),
    true,
  );
  const report = {
    passed: true,
    browser: await browser.version(),
    testedAt: new Date().toISOString(),
    subpath: true,
    formats: ['lxma', 'RSCP1', 'RSCP2'],
    codecs: ['LSB', 'DCT', 'legacy unit coverage'],
    encryptedRetry: true,
    independentProcess: true,
    separateFieldCopy: true,
    qrRoundTrip: true,
    offlineWithoutNetwork: true,
    actualOfflineDownload: true,
    paperRoundTrips: true,
    paperQrImport: true,
    paperMaxQr: true,
    mobileNoOverflow: true,
    noUploadsOrExternalRequests: true,
    errors,
  };
  await writeFile(path.join(out, 'portable-browser-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
