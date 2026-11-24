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

  // Ключ OpenRouter для прокси Fracs AI (/api/app/ai): хранится ТОЛЬКО на сервере,
  // в сборку программы не попадает. Пользовательский запрос идёт с ключом лицензии.
  openrouterApiKey: env.OPENROUTER_API_KEY || '',
  openrouterUrl: 'https://openrouter.ai/api/v1',

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
   *  Start — ['base','telegram','cards'] (парсинг Telegram + карты). PRO добавляет
   *  'owners', 'training' и 'ai_provider' (свой провайдер в AI-агенте). Ultra добавляет
   *  'fracs_ai' (встроенный Fracs AI). Админ (ADMIN_TG_ID) видит всё. */
  features?: string[];
}

export const PLANS: Plan[] = [
  {
    id: 'start',
    title: 'Start',
    days: 30,
    priceRub: 1800,
    features: ['base', 'telegram', 'cards'],
    description: 'Парсинг Telegram и карт 2ГИС: база контактов и выгрузки CSV/HTML на 30 дней.',
  },
  {
    id: 'pro',
    title: 'PRO',
    days: 30,
    priceRub: 2700,
    badge: 'Владельцы + Обучение',
    features: ['base', 'telegram', 'cards', 'owners', 'training', 'ai_provider'],
    description: 'Всё из «Start» + поиск владельцев (руководитель / ИП, ИНН, контакты), раздел «Обучение» и AI-агент со своим провайдером (свой API-ключ).',
  },
  {
    id: 'ultra',
    title: 'Ultra',
    days: 30,
    priceRub: 4500,
    badge: 'Максимум',
    features: ['base', 'telegram', 'cards', 'owners', 'training', 'ai_provider', 'fracs_ai', 'ai', 'business'],
    description: 'Всё из «PRO» + встроенный Fracs AI (генерация сайтов и фраз на встроенном ключе, отдельная кнопка в AI-агенте). Максимум возможностей.',
  },
];

/** Все известные коды возможностей (админу выдаём весь список). */
export const ALL_FEATURES = Array.from(new Set(PLANS.flatMap((p) => p.features ?? [])));
