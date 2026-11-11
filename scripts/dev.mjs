import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const csp =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
};
export function createStaticServer({ directory = path.join(root, 'public'), prefix = '/' } = {}) {
  directory = path.resolve(directory);
  if (!prefix.endsWith('/')) prefix += '/';
  return http.createServer(async (req, res) => {
    const headers = {
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-cache',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    };
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, headers).end();
      return;
    }
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith(prefix)) throw Error('Not found');
      const relative = decodeURIComponent(url.pathname.slice(prefix.length));
      const file = path.resolve(directory, relative || 'index.html');
      if (
        !file.startsWith(directory + path.sep) ||
        relative.split('/').some((p) => p.startsWith('.'))
      )
        throw Error('Not found');
      if (!(await stat(file)).isFile()) throw Error('Not found');
      const bytes = await readFile(file);
      if (path.basename(file) === 'packrat-offline.html') delete headers['Content-Security-Policy'];
      res.writeHead(200, {
        ...headers,
        'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch {
      res.writeHead(404, { ...headers, 'Content-Type': 'text/plain' }).end('Not found');
    }
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2),
    option = (name, fallback) => {
      const i = args.indexOf(name);
      return i < 0 ? fallback : args[i + 1];
    };
  const host = option('--host', '127.0.0.1'),
    port = Number(option('--port', '5173')),
    directory = path.resolve(root, option('--dir', 'public'));
  const server = createStaticServer({ directory });
  server.listen(port, host, () => console.log(`Packrat: http://${host}:${server.address().port}/`));
}
