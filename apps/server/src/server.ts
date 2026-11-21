import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Server } from './colyseus';
import { HuntRoom } from './rooms/HuntRoom';

const here = path.dirname(fileURLToPath(import.meta.url));
export const clientRoot = path.resolve(here, '../../client');

/** Creates the HTTP + Colyseus server. mode: 'dev' (Vite middleware), 'prod' (static dist) or 'none' (tests). */
export async function createGameServer(port: number, mode: 'dev' | 'prod' | 'none') {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => { res.json({ ok: true }); });
  if (mode === 'prod') app.use(express.static(path.join(clientRoot, 'dist')));
  if (mode === 'dev') {
    const { createServer } = await import('vite');
    const vite = await createServer({ root: clientRoot, configFile: path.join(clientRoot, 'vite.config.ts'), server: { middlewareMode: true, hmr: { port: 24678 } }, appType: 'spa' });
    app.use(vite.middlewares);
  }
  const server = http.createServer(app);
  const gameServer = new Server({ transport: new WebSocketTransport({ server, maxPayload: 16 * 1024 }) });
  gameServer.define('hunt', HuntRoom);
  await gameServer.listen(port);
  return gameServer;
}
