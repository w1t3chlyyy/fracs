import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { config } from './server/config.ts';
import { initDb } from './server/db.ts';
import { attachUser } from './server/auth.ts';
import { startBot, webhookHandler } from './server/bot.ts';
import { api } from './server/routes.ts';

async function main() {
  initDb();
  await startBot().catch((e) => console.error('[bot] не запущен:', e.message));

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  app.post('/api/bot/webhook', webhookHandler);
  app.use('/api', attachUser, api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

  if (config.isProd) {
    const dist = path.join(process.cwd(), 'dist');
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === 'entity.parse.failed') return void res.status(400).json({ error: 'bad_json' });
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  });

  app.listen(config.port, '0.0.0.0', () => console.log(`Fracs: ${config.appUrl} (${config.isProd ? 'production' : 'dev'})`));
}

main();
