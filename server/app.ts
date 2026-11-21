import express, { type NextFunction, type Request, type Response } from 'express';
import { attachUser } from './auth.ts';
import { webhookHandler } from './bot.ts';
import { appRouter } from './appRoutes.ts';
import { adminRouter } from './adminRoutes.ts';
import { api } from './routes.ts';
import { csrfGuard, limit, noStoreApi, securityHeaders } from './security.ts';

export function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(securityHeaders);

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
  app.use('/api', noStoreApi, csrfGuard);
  app.use('/api/cities', limit('cities', 60, 60_000));
  app.use('/api/config', limit('config', 60, 60_000));
  // Админ-панель Telegram Mini App (/admin.html): валидация по initData в самом роутере.
  app.use('/api/admin', adminRouter);
  // Программа Fracs Parser: ключ, скачивание, проверка лицензии.
  app.use('/api/app', attachUser, appRouter);
  app.use('/api', attachUser, api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === 'entity.parse.failed') return void res.status(400).json({ error: 'bad_json' });
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  });
  return app;
}
