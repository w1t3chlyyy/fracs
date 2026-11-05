// Постоянный сервер: локальная разработка (`npm run dev`) или VPS. На Vercel не используется — там api/index.js.
import express from 'express';
import path from 'node:path';
import { config } from './server/config.ts';
import { startBot } from './server/bot.ts';
import { buildApp } from './server/app.ts';

async function main() {
  await startBot().catch((e) => console.error('[bot] не запущен:', e.message));

  const app = buildApp();
  if (config.isProd) {
    const dist = path.join(process.cwd(), 'dist');
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }

  app.listen(config.port, '0.0.0.0', () => console.log(`Fracs: ${config.appUrl} (${config.isProd ? 'production' : 'dev'})`));
}

main();
