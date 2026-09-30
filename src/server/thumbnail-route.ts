import type { IncomingMessage, ServerResponse } from 'http';
import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { MqttBridge } from './mqtt-bridge.js';
import { thumbCacheDir } from './data-paths.js';
import { getLogger } from './logger.js';

const log = getLogger('Thumbs');

/** Une seule demande 1045 à la fois : l'imprimante sature vite sur des rafales. */
let chain: Promise<unknown> = Promise.resolve();
const inflight = new Map<string, Promise<Buffer | null>>();

function fetchThumb(bridge: MqttBridge, source: string, file: string): Promise<Buffer | null> {
  const run = chain.then(async () => {
    const data = await bridge.request(1045, { storage_media: source, file_name: file }, 15_000);
    const result = data.result as { error_code?: number; thumbnail?: string } | undefined;
    if (!result?.thumbnail || result.error_code) return null;
    return Buffer.from(result.thumbnail, 'base64');
  });
  chain = run.catch(() => undefined);
  return run;
}

/**
 * GET /api/files/thumbnail?file=&source=&v= : miniature PNG d'un fichier de l'imprimante,
 * mise en cache disque. `v` (date de création) change la clé quand le fichier est remplacé.
 */
export async function handleThumbnail(
  req: IncomingMessage,
  res: ServerResponse,
  bridge: MqttBridge | null,
): Promise<void> {
  const params = new URL(req.url ?? '', 'http://localhost').searchParams;
  const file = params.get('file');
  const source = params.get('source') === 'u-disk' ? 'u-disk' : 'local';
  if (!file) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing file parameter' }));
    return;
  }
  const key = createHash('sha256')
    .update(`${source}:${file}:${params.get('v') ?? ''}`)
    .digest('hex')
    .slice(0, 20);
  const path = join(thumbCacheDir(), `${key}.png`);

  const send = (png: Buffer) => {
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=604800, immutable',
      'Content-Length': png.length,
    });
    res.end(png);
  };

  try {
    send(await readFile(path));
    return;
  } catch {
    /* absente du cache : demandée à l'imprimante */
  }
  if (!bridge?.isConnected) {
    res.writeHead(503);
    res.end();
    return;
  }

  let pending = inflight.get(key);
  if (!pending) {
    pending = fetchThumb(bridge, source, file)
      .then(async (png) => {
        if (png) {
          await mkdir(thumbCacheDir(), { recursive: true });
          await writeFile(path, png);
        }
        return png;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  try {
    const png = await pending;
    if (png) send(png);
    else {
      res.writeHead(404, { 'Cache-Control': 'private, max-age=3600' });
      res.end();
    }
  } catch (err) {
    log.warn(`thumbnail ${file}: ${(err as Error).message}`);
    if (!res.headersSent) {
      res.writeHead(504);
      res.end();
    }
  }
}
