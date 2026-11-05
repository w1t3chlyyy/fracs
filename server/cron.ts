import type { Request, Response } from 'express';
import { config } from './config.ts';
import { cleanup, markReminded, usersToRemind } from './db.ts';
import { notify } from './bot.ts';
import { safeEqual } from './util.ts';

/**
 * Раз в час/сутки (cron-job.org): чистит просроченные токены, лимиты и старые поиски,
 * напоминает в Telegram о скором окончании подписки.
 * Авторизация: заголовок  Authorization: Bearer <CRON_SECRET>
 */
export async function cronHandler(req: Request, res: Response) {
  const got = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!config.cronSecret || !safeEqual(got, config.cronSecret)) return void res.status(401).json({ error: 'unauthorized' });

  await cleanup(config.searchRetentionDays);

  let reminded = 0;
  for (const u of await usersToRemind()) {
    const left = Math.max(1, Math.ceil((Date.parse(u.subscriptionUntil!) - Date.now()) / 86400_000));
    await notify(u.tgId, `⏳ Подписка Fracs закончится через ${left} дн. (${new Date(u.subscriptionUntil!).toLocaleDateString('ru-RU')}). Продлить: ${config.appUrl}/app`);
    await markReminded(u.id, u.subscriptionUntil!);
    reminded++;
  }
  res.json({ ok: true, reminded });
}
