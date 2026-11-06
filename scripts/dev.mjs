// Small local-only development server. No extra package is needed.
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('../public/', import.meta.url)));
const port = Number(process.env.PORT || 8000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('PORT must be a number between 0 and 65535.');
  process.exit(1);
}
const types = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp', '.ico':'image/x-icon'
};
const insideRoot = path => path === root || path.startsWith(root + sep);

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control','no-store');
  response.setHeader('X-Content-Type-Options','nosniff');
  if (!['GET','HEAD'].includes(request.method)) {
    response.writeHead(405, {Allow:'GET, HEAD'}).end('Method not allowed');
    return;
  }
  let url, requested;
  try {
    url = new URL(request.url, 'http://127.0.0.1');
    requested = decodeURIComponent(url.pathname);
    if (requested.includes('\0') || requested.split('/').includes('..')) throw new Error('Invalid path');
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }
  try {
    let file = await realpath(resolve(root, '.' + requested));
    if (!insideRoot(file)) { response.writeHead(403).end('Forbidden'); return; }
    const info = await stat(file);
    if (info.isDirectory()) {
      if (!url.pathname.endsWith('/')) {
        response.writeHead(301, {Location:url.pathname + '/' + url.search}).end();
        return;
      }
      file = await realpath(join(file,'index.html'));
      if (!insideRoot(file)) { response.writeHead(403).end('Forbidden'); return; }
    }
    const data = await readFile(file);
    response.writeHead(200, {'Content-Type':types[extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length':data.length});
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch (error) {
    if (['ENOENT','ENOTDIR','EISDIR'].includes(error.code)) response.writeHead(404).end('Not found');
    else response.writeHead(500).end('Could not read file');
  }
});

server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Try PORT=8001 npm run dev.` : 'Could not start the local server.');
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  const actualPort = server.address().port;
  console.log(`Website: http://127.0.0.1:${actualPort}/`);
  console.log(`Admin:   http://127.0.0.1:${actualPort}/holyghost/`);
  console.log('Press Ctrl+C to stop. Configure public/supabase-config.js before using the admin.');
});
