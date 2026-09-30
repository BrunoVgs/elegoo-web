import type { IncomingMessage, ServerResponse } from 'http';
import { createReadStream } from 'fs';
import { copyFile, mkdir, readFile, readdir, realpath, stat } from 'fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'path';
import type { ServiceConfig } from './config.js';
import { getLogger } from './logger.js';
import {
  cacheGcodeBuffer,
  getCachedGcode,
  precacheGcodeAsync,
  uploadToPrinter,
} from './rest-api.js';

const log = getLogger('Library');

/** Sous-dossier où l'archivage dépose les G-codes récupérés sur l'imprimante. */
const ARCHIVE_DIR = 'GCODEs';
const MAX_SEND = 500 * 1024 * 1024;

const TYPES: Record<string, string> = {
  '.gcode': 'text/plain; charset=utf-8',
  '.stl': 'model/stl',
  '.3mf': 'model/3mf',
  '.glb': 'model/gltf-binary',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((ok, fail) => {
    let body = '';
    req.on('data', (c: Buffer) => {
      body += c.toString();
      if (body.length > 64 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        ok(JSON.parse(body || '{}'));
      } catch (err) {
        fail(err);
      }
    });
    req.on('error', fail);
  });
}

/**
 * Chemin absolu d'un élément de la bibliothèque, ou `null` s'il en sort : le chemin
 * résolu, liens symboliques compris, doit rester sous la racine.
 */
async function safePath(root: string, rel: string): Promise<string | null> {
  const target = resolve(root, `.${sep}${rel}`);
  try {
    const real = await realpath(target);
    const realRoot = await realpath(root);
    return real === realRoot || real.startsWith(realRoot + sep) ? real : null;
  } catch {
    return null;
  }
}

/**
 * Routes `/api/library*` : parcourir la bibliothèque, lire un fichier, envoyer un G-code
 * à l'imprimante, archiver un fichier de l'imprimante. Rend `false` si l'URL n'en est pas.
 */
export function handleLibraryRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServiceConfig,
): boolean {
  const url = new URL(req.url ?? '', 'http://localhost');
  if (!url.pathname.startsWith('/api/library')) return false;
  const root = config.libraryDir;
  if (!root) {
    json(res, 404, { error: 'Library disabled (LIBRARY_DIR unset)' });
    return true;
  }
  void route(req, res, url, root, config).catch((err) => {
    log.error(`${url.pathname}: ${(err as Error).message}`);
    if (!res.headersSent) json(res, 500, { error: (err as Error).message });
  });
  return true;
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  root: string,
  config: ServiceConfig,
): Promise<void> {
  if (url.pathname === '/api/library' && req.method === 'GET') {
    const dir = await safePath(root, url.searchParams.get('dir') ?? '');
    if (!dir) return json(res, 404, { error: 'No such folder' });
    const names = await readdir(dir, { withFileTypes: true });
    const entries = await Promise.all(
      names
        .filter((d) => !d.name.startsWith('.') && (d.isDirectory() || d.isFile()))
        .map(async (d) => {
          const s = await stat(join(dir, d.name));
          return {
            name: d.name,
            type: d.isDirectory() ? 'dir' : 'file',
            size: s.size,
            mtime: s.mtimeMs,
          };
        }),
    );
    return json(res, 200, { dir: relative(await realpath(root), dir), entries });
  }

  if (url.pathname === '/api/library/file' && req.method === 'GET') {
    const file = await safePath(root, url.searchParams.get('path') ?? '');
    const s = file ? await stat(file) : null;
    if (!file || !s?.isFile()) return json(res, 404, { error: 'No such file' });
    const headers: Record<string, string | number> = {
      'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': s.size,
    };
    if (url.searchParams.get('download'))
      headers['Content-Disposition'] =
        `attachment; filename*=UTF-8''${encodeURIComponent(basename(file))}`;
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
    return;
  }

  if (url.pathname === '/api/library/send' && req.method === 'POST') {
    const body = await readBody(req);
    const file = await safePath(root, String(body.path ?? ''));
    if (!file || extname(file).toLowerCase() !== '.gcode')
      return json(res, 400, { error: 'Only .gcode files can be sent' });
    const s = await stat(file);
    if (s.size > MAX_SEND) return json(res, 413, { error: 'File too large (max 500MB)' });
    const data = await readFile(file);
    const name = basename(file);
    const sent = await uploadToPrinter(config, '/upload', name, data);
    if (!sent.ok) return json(res, 502, { error: sent.error, error_code: sent.errorCode });
    void cacheGcodeBuffer(name, data, config);
    log.info(`Sent ${name} from library to printer (${s.size} bytes)`);
    return json(res, 200, { ok: true, fileName: name, size: s.size });
  }

  if (url.pathname === '/api/library/archive' && req.method === 'POST') {
    const body = await readBody(req);
    const file = String(body.file ?? '');
    const source = body.source === 'u-disk' ? 'u-disk' : 'local';
    if (!file.toLowerCase().endsWith('.gcode'))
      return json(res, 400, { error: 'Only .gcode files can be archived' });
    const cached = await precacheGcodeAsync(file, config, source);
    const path = cached.ok ? await getCachedGcode(file, config) : null;
    if (!path) return json(res, 502, { error: cached.error ?? 'Download from printer failed' });
    const destDir = join(root, ARCHIVE_DIR);
    await mkdir(destDir, { recursive: true });
    const dest = join(destDir, basename(file));
    await copyFile(path, dest);
    log.info(`Archived ${file} to ${dest}`);
    return json(res, 200, { ok: true, path: join(ARCHIVE_DIR, basename(file)) });
  }

  json(res, 404, { error: 'Unknown library route' });
}
