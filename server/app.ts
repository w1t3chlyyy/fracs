import express, { type NextFunction, type Request, type Response } from 'express';
import { attachUser } from './auth.ts';
import { webhookHandler } from './bot.ts';
import { api } from './routes.ts';

export function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Vercel может уже прочитать тело запроса сам; тогда повторно парсить поток нельзя (иначе 500).
  app.use((req, _res, next) => {
    try {
      const b = (req as any).body;
      if (b !== undefined && b !== null && typeof b === 'object' && !Buffer.isBuffer(b)) (req as any)._body = true;
      next();
    } catch (e) {
      next(Object.assign(e as Error, { type: 'entity.parse.failed' }));
    }
  });
  app.use(express.json({ limit: '100kb' }));

  app.post('/api/bot/webhook', webhookHandler);
  app.use('/api', attachUser, api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === 'entity.parse.failed') return void res.status(400).json({ error: 'bad_json' });
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  });
  return app;
}
