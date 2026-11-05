import 'dotenv/config';

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const port = Number(env.PORT || 3000);

export const config = {
  isProd,
  port,
  appUrl: (env.APP_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  sessionSecret: env.SESSION_SECRET || (isProd ? '' : 'dev-secret-change-me'),

  botToken: env.TELEGRAM_BOT_TOKEN || '',
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
  dataFile: env.DATA_FILE || 'data/db.json',
};

if (isProd && !config.sessionSecret) {
  throw new Error('SESSION_SECRET обязателен в production (любая длинная случайная строка).');
}

export interface Plan {
  id: string;
  title: string;
  days: number;
  priceRub: number;
  badge?: string;
}

// Цены — заглушки, поставьте свои.
export const PLANS: Plan[] = [
  { id: 'month', title: '1 месяц', days: 30, priceRub: 4900 },
  { id: 'quarter', title: '3 месяца', days: 90, priceRub: 12900, badge: 'Выгоднее на 12%' },
];
