import { readFile, writeFile, mkdir, rm, copyFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { root } from './dev.mjs';
const [major, minor, patch] = process.versions.node.split('.').map(Number);
if (major !== 24 || minor < 22 || (minor === 22 && patch < 3)) {
  throw Error('Build with up-to-date Node 24 LTS (minimum 24.22.3).');
}
const source = path.join(root, 'public'),
  dist = path.join(root, 'dist');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const assets = [
  'app.js',
  'codec.js',
  'contact-card.js',
  'dct-codec.js',
  'favicon.svg',
  'fonts/jetbrains-mono-LICENSE.txt',
  'fonts/jetbrains-mono-latin.woff2',
  'fonts/outfit-LICENSE.txt',
  'fonts/outfit-latin.woff2',
  'image-codec.js',
  'index.html',
  'lsb-codec.js',
  'paper-message.js',
  'qr-reader.js',
  'style.css',
  'vendor/jsQR-LICENSE.txt',
  'vendor/jsQR.js',
  'vendor/noto-emoji-LICENSE.txt',
  'vendor/qrcode-LICENSE.txt',
  'vendor/qrcode.js',
];
for (const name of assets) {
  const file = path.join(source, name);
  if (!(await lstat(file)).isFile() || (await realpath(file)) !== file) {
    throw Error('Build assets must be regular files without symlinks: ' + name);
  }
}
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const name of assets) {
  const destination = path.join(dist, name);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(source, name), destination);
}
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md'])
  await copyFile(path.join(root, name), path.join(dist, name));
await writeFile(path.join(dist, '.nojekyll'), '');
let html = await readFile(path.join(source, 'index.html'), 'utf8');
html = html.replaceAll('__APP_VERSION__', pkg.version);
await writeFile(path.join(dist, 'index.html'), html);
const compiled = await build({
  entryPoints: [path.join(source, 'app.js')],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
  minify: true,
  legalComments: 'inline',
  metafile: true,
});
for (const input of Object.keys(compiled.metafile.inputs)) {
  if (!assets.includes(path.relative(source, path.resolve(input)).split(path.sep).join('/')))
    throw Error('Unlisted bundle input: ' + input);
}
const vendors = await Promise.all(
  ['qrcode.js', 'jsQR.js'].map((name) => readFile(path.join(source, 'vendor', name), 'utf8')),
);
const script = [...vendors, compiled.outputFiles[0].text]
  .join('\n;\n')
  .replace(/<\/script/gi, '<\\/script');
let css = await readFile(path.join(source, 'style.css'), 'utf8');
for (const name of ['outfit-latin.woff2', 'jetbrains-mono-latin.woff2']) {
  const data = (await readFile(path.join(source, 'fonts', name))).toString('base64');
  css = css.replaceAll('./fonts/' + name, 'data:font/woff2;base64,' + data);
}
const hash = (text) => createHash('sha256').update(text).digest('base64');
const policy = `default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(css)}'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
const mark = (await readFile(path.join(source, 'favicon.svg'))).toString('base64');
let offline = html
  .replace(
    /<meta http-equiv="Content-Security-Policy"[^>]*>/,
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
  )
  .replace(/<link rel="stylesheet" href="style.css">/, `<style>${css}</style>`)
  .replace(
    /<script src="vendor\/qrcode.js" defer><\/script>\s*<script src="vendor\/jsQR.js" defer><\/script>\s*<script src="app.js" type="module"><\/script>/,
    () => `<script>${script}</script>`,
  )
  .replaceAll('="favicon.svg"', `="data:image/svg+xml;base64,${mark}"`)
  .replace('href="./"', 'href="#"')
  .replace(/<a[^>]+id="offline-download"[^>]*>[^<]*<\/a>/, '');
// Execute the bundle after the DOM exists, preserving the external defer/module ordering.
const bundledTag = `<script>${script}</script>`;
offline = offline.replace(bundledTag, '').replace('</body>', () => bundledTag + '\n</body>');
const license = (
  await Promise.all(
    [
      'LICENSE',
      'THIRD_PARTY_NOTICES.md',
      'public/vendor/qrcode-LICENSE.txt',
      'public/vendor/jsQR-LICENSE.txt',
      'public/vendor/noto-emoji-LICENSE.txt',
      'public/fonts/outfit-LICENSE.txt',
      'public/fonts/jetbrains-mono-LICENSE.txt',
    ].map((name) => readFile(path.join(root, name), 'utf8')),
  )
).join('\n\n');
offline = offline.replace(
  '</body>',
  `<!-- Third-party notices: ${license.replaceAll('--', '—')} -->\n</body>`,
);
await writeFile(path.join(dist, 'packrat-offline.html'), offline);
// Static module loaded only by an explicit offline-download click.
await writeFile(
  path.join(dist, 'offline-download.js'),
  'export const offlineHtml=' + JSON.stringify(offline) + ';\n',
);
console.log(`Built dist/ and a self-contained offline HTML file (${pkg.version}).`);
