import crypto from 'node:crypto';
import 'dotenv/config';

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const port = Number(env.PORT || 3000);
const vercelUrl = env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '';

export const config = {
  isProd,
  port,
  appUrl: (env.APP_URL || vercelUrl || `http://localhost:${port}`).replace(/\/$/, ''),
  sessionSecret: env.SESSION_SECRET || (isProd ? crypto.randomBytes(32).toString('hex') : 'dev-secret-change-me'),

  supabaseUrl: env.SUPABASE_URL || '',
  supabaseKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
  cronSecret: env.CRON_SECRET || '',
  searchRetentionDays: Number(env.SEARCH_RETENTION_DAYS || 30),

  botToken: env.TELEGRAM_BOT_TOKEN || '',
  botUsername: (env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, ''),
  // На Vercel работает только webhook. polling — для локальной разработки.
  botMode: (env.TELEGRAM_BOT_MODE === 'webhook' ? 'webhook' : 'polling') as 'polling' | 'webhook',
  webhookSecret: env.TELEGRAM_WEBHOOK_SECRET || '',
  // Вход без бота — только для локальной разработки (или если явно включено).
  devLogin: env.ALLOW_DEV_LOGIN === 'true' || (!isProd && !env.TELEGRAM_BOT_TOKEN),

  mapsProvider: (env.MAPS_PROVIDER || 'mock') as 'mock' | '2gis',
  gisKey: env.GIS_API_KEY || '',
  mapsWorkerUrl: (env.MAPS_WORKER_URL || '').replace(/\/$/, ''),
  mapsWorkerToken: env.MAPS_WORKER_TOKEN || '',
  tgProvider: (env.TG_PROVIDER || 'mock') as 'mock' | 'http',
  tgParserUrl: (env.TG_PARSER_URL || '').replace(/\/$/, ''),
  tgParserKey: env.TG_PARSER_KEY || '',

  paymentProvider: (env.PAYMENT_PROVIDER || 'mock') as 'mock' | 'yookassa',
  allowMockPayments: !isProd || env.ALLOW_MOCK_PAYMENTS === 'true',
  yookassaShopId: env.YOOKASSA_SHOP_ID || '',
  yookassaSecret: env.YOOKASSA_SECRET_KEY || '',

  dailySearchLimit: Number(env.DAILY_SEARCH_LIMIT || 40),

  // Telegram ID админа (число, не @username): подписка ему не нужна, всё открыто.
  adminTgId: Number(env.ADMIN_TG_ID) || 0,
  // @username админа: кнопка оплаты в кабинете ведёт в чат с ним (t.me/<username>).
  adminUsername: (env.ADMIN_TG_USERNAME || '').replace(/^@/, ''),

  // Обязательные подписки на каналы перед активацией кабинета. Список через запятую:
  // @username канала или его числовой ID (-100…). Бот должен быть админом в каждом канале,
  // иначе getChatMember не увидит статус. Проверяется при старте в боте и на каждом действии
  // в кабинете/программе; админ (ADMIN_TG_ID) проверку проходит всегда.
  requiredChannels: (env.REQUIRED_CHANNELS || '')
    .split(',')
    .map((s) => s.trim().replace(/^@/, ''))
    .filter(Boolean),
};

// Намеренное поведение: при отсутствии обязательных переменных функция не стартует,
// а не работает с дырой. Секрет сгенерируйте так: openssl rand -hex 32.
if (isProd) {
  const missing = ['SESSION_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`[config] В production обязательны: ${missing.join(', ')}`);
  if (env.SESSION_SECRET!.length < 32) throw new Error('[config] SESSION_SECRET должен быть ≥ 32 символов');
  if (env.ALLOW_DEV_LOGIN === 'true') throw new Error('[config] ALLOW_DEV_LOGIN запрещён в production');
  if (env.ALLOW_MOCK_PAYMENTS === 'true') throw new Error('[config] ALLOW_MOCK_PAYMENTS запрещён в production');
}

export interface Plan {
  id: string;
  title: string;
  days: number;
  priceRub: number;
  badge?: string;
  description?: string;
  /** Коды возможностей, открываемых тарифом. Гейтятся на сервере и в программе.
   *  Базовые тарифы — ['base']; PRO добавляет 'owners' (поиск владельцев) и
   *  'training' (раздел «Обучение»). Админ видит всё. */
  features?: string[];
}

export const PLANS: Plan[] = [
  {
    id: 'month',
    title: '1 месяц',
    days: 30,
    priceRub: 1800,
    features: ['base'],
    description: 'Доступ к программе Fracs Parser, базе контактов и выгрузкам на 30 дней.',
  },
  {
    id: 'quarter',
    title: '3 месяца',
    days: 90,
    priceRub: 4500,
    badge: 'Выгоднее на 17%',
    features: ['base'],
    description: 'Доступ на 90 дней: экономия 900 ₽ при оплате сразу за квартал.',
  },
  {
    id: 'pro',
    title: 'PRO 1 месяц',
    days: 30,
    priceRub: 2700,
    badge: 'Владельцы + Обучение',
    features: ['base', 'owners', 'training'],
    description: 'Всё из базового тарифа + поиск владельцев (руководитель / ИП, ИНН, контакты) и раздел «Обучение».',
  },
];

/** Все известные коды возможностей (админу выдаём весь список). */
export const ALL_FEATURES = Array.from(new Set(PLANS.flatMap((p) => p.features ?? [])));
