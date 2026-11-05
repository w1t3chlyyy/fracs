import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.ts';

export interface User {
  id: string;
  tgId: number;
  username: string | null;
  firstName: string;
  createdAt: string;
  subscriptionUntil: string | null;
}

export interface LoginToken {
  token: string;
  createdAt: number;
  userId?: string;
}

export interface SearchRecord {
  id: string;
  userId: string;
  kind: 'maps' | 'tg';
  createdAt: string;
  demo: boolean;
  seed: string;
  query: { niche?: string; cityId?: string; cityLabel?: string; phrase?: string; days?: number };
  stats: Record<string, number>;
  /** Только для реальных провайдеров; демо-строки генерируются на лету. */
  rows?: unknown[];
}

export interface PaymentRecord {
  id: string;
  userId: string;
  planId: string;
  amountRub: number;
  status: 'pending' | 'succeeded' | 'canceled';
  provider: string;
  providerId: string | null;
  createdAt: string;
  paidAt: string | null;
}

interface Schema {
  users: User[];
  loginTokens: LoginToken[];
  searches: SearchRecord[];
  payments: PaymentRecord[];
}

// Простое файловое хранилище. Для продакшена с несколькими инстансами замените на Postgres/Supabase —
// весь доступ к данным идёт через этот модуль.
export const data: Schema = { users: [], loginTokens: [], searches: [], payments: [] };

const file = path.resolve(process.cwd(), config.dataFile);
let timer: NodeJS.Timeout | null = null;

export function initDb() {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    Object.assign(data, { users: [], loginTokens: [], searches: [], payments: [] }, raw);
  } catch {
    /* первый запуск */
  }
  const flush = () => {
    saveNow();
    process.exit(0);
  };
  process.on('SIGINT', flush);
  process.on('SIGTERM', flush);
}

function saveNow() {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error('[db] не удалось сохранить', e);
  }
}

export function save() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    saveNow();
  }, 300);
}

export const newId = () => crypto.randomUUID();

export function upsertTgUser(from: { id: number; username?: string; first_name?: string }): User {
  let u = data.users.find((x) => x.tgId === from.id);
  if (!u) {
    u = {
      id: newId(),
      tgId: from.id,
      username: from.username ?? null,
      firstName: from.first_name || 'Пользователь',
      createdAt: new Date().toISOString(),
      subscriptionUntil: null,
    };
    data.users.push(u);
  } else {
    u.username = from.username ?? null;
    if (from.first_name) u.firstName = from.first_name;
  }
  save();
  return u;
}

export const isSubscribed = (u: User) => !!u.subscriptionUntil && Date.parse(u.subscriptionUntil) > Date.now();

export function extendSubscription(u: User, days: number) {
  const base = isSubscribed(u) ? Date.parse(u.subscriptionUntil!) : Date.now();
  u.subscriptionUntil = new Date(base + days * 86400000).toISOString();
  save();
}
