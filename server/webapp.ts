import crypto from 'node:crypto';
import { config } from './config.ts';

export interface TgUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
}

/**
 * Проверка Telegram Web App initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
 * initData — строка вида "query=...&user=...&auth_date=...&hash=...", которую Mini App
 * получает в Telegram.WebApp.initData и шлёт на сервер (заголовок x-tg-initdata).
 */
export function verifyInitData(initData: string): { ok: boolean; user?: TgUser; error?: string } {
  if (!config.botToken || typeof initData !== 'string' || !initData.trim()) {
    return { ok: false, error: 'no_init_data' };
  }
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  const authDate = Number(params.get('auth_date') || 0);
  if (!hash || hash.length !== 64 || !authDate) {
    return { ok: false, error: 'bad_init_data' };
  }
  // 1 час против повтора перехваченной строки.
  if (Date.now() / 1000 - authDate > 3600) {
    return { ok: false, error: 'expired' };
  }
  params.delete('hash');
  // data-check-string: поля по алфавиту, "key=value", через \n.
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const a = Buffer.from(calc);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'bad_hash' };
  }
  const userRaw = params.get('user');
  let user: TgUser | undefined;
  try {
    user = userRaw ? (JSON.parse(userRaw) as TgUser) : undefined;
  } catch {
    /* ignore */
  }
  return { ok: true, user };
}

/** true — initData валиден и принадлежит админу (ADMIN_TG_ID). */
export function isAdminInitData(initData: string): boolean {
  const v = verifyInitData(initData);
  return !!v.ok && !!v.user && v.user.id === config.adminTgId;
}
