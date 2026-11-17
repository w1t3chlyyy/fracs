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
};

if (isProd && !env.SESSION_SECRET) {
  console.warn('[config] SESSION_SECRET не задан — используется временный ключ сессии.');
}

export interface Plan {
  id: string;
  title: string;
  days: number;
  priceRub: number;
  badge?: string;
  description?: string;
}

export const PLANS: Plan[] = [
  {
    id: 'month',
    title: '1 месяц',
    days: 30,
    priceRub: 1800,
    description: 'Доступ к программе Fracs Parser, базе контактов и выгрузкам на 30 дней.',
  },
  {
    id: 'quarter',
    title: '3 месяца',
    days: 90,
    priceRub: 4500,
    badge: 'Выгоднее на 17%',
    description: 'Доступ на 90 дней: экономия 900 ₽ при оплате сразу за квартал.',
  },
];
