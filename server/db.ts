import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config, PLANS, ALL_FEATURES, type Plan } from './config.ts';

export interface User {
  id: string;
  /** Telegram ID. Для аккаунтов, созданных входом по email-коду, — null. */
  tgId: number | null;
  /** Email (вход по одноразовому коду через Supabase Auth). У TG-пользователей — null. */
  email: string | null;
  username: string | null;
  firstName: string;
  createdAt: string;
  subscriptionUntil: string | null;
  /** Тариф, по которому выдана подписка (start/pro/ultra; legacy: month/quarter). */
  planId: string | null;
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
  rowsTotal: number;
  /** Первые 3 строки реального провайдера — для замаскированного превью. */
  head?: unknown[];
  /** Только для реальных провайдеров и только если запрошено; демо-строки генерируются на лету. */
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

export const useSupabase = Boolean(config.supabaseUrl && config.supabaseKey);

let client: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (!client) {
    if (!config.supabaseUrl || !config.supabaseKey) {
      throw new Error('Не заданы SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY');
    }
    client = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/* ── Fallback in-memory storage (работает автономно, если Supabase не настроен) ── */
const memUsers = new Map<string, User>();
const memTgUsers = new Map<number, string>();
const memEmailUsers = new Map<string, string>();
const memTokens = new Map<string, { token: string; createdAt: number; userId?: string }>();
const memSearches = new Map<string, SearchRecord>();
const memPayments = new Map<string, PaymentRecord>();
const memLimits = new Map<string, { count: number; resetAt: number }>();
const memExpiryNotified = new Map<string, string>();
const memTrialUsage = new Set<string>();

export function initDb() {
  if (useSupabase) {
    console.log('[db] Подключен Supabase');
  } else {
    console.log('[db] Работаем в автономном in-memory режиме (Supabase не настроен)');
  }
}

function check<T>(r: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (r.error) throw new Error(`[db] ${what}: ${r.error.message}`);
  return (r.data as NonNullable<T>);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

export const newId = () => crypto.randomUUID();

/* ── пользователи ── */

const ADMIN_UNTIL = '2099-12-31T00:00:00.000Z';

const isAdminTg = (tgId: number | null) => config.adminTgId > 0 && tgId === config.adminTgId;

/** Админу (ADMIN_TG_ID) подписка не нужна: считаем её вечной. В базу это не пишется. */
function withAdmin(u: User): User {
  return isAdminTg(u.tgId) ? { ...u, subscriptionUntil: ADMIN_UNTIL } : u;
}

const userOf = (r: any): User => withAdmin({
  id: r.id,
  tgId: r.tg_id == null ? null : Number(r.tg_id),
  email: r.email ?? null,
  username: r.username,
  firstName: r.first_name,
  createdAt: r.created_at,
  subscriptionUntil: r.subscription_until,
  planId: r.plan_id ?? null,
});

export async function getUser(id: string): Promise<User | null> {
  if (!UUID.test(id)) return null;
  if (useSupabase) {
    const r = await sb().from('users').select('*').eq('id', id).maybeSingle();
    const row = check(r, 'getUser');
    return row ? userOf(row) : null;
  }
  const mu = memUsers.get(id);
  return mu ? withAdmin({ ...mu }) : null;
}

export async function upsertTgUser(from: { id: number; username?: string; first_name?: string }): Promise<User> {
  if (useSupabase) {
    const existing = check(await sb().from('users').select('first_name').eq('tg_id', from.id).maybeSingle(), 'upsertTgUser.find');
    const r = await sb()
      .from('users')
      .upsert(
        { tg_id: from.id, username: from.username ?? null, first_name: from.first_name || existing?.first_name || 'Пользователь' },
        { onConflict: 'tg_id' },
      )
      .select('*')
      .single();
    return userOf(check(r, 'upsertTgUser'));
  }

  const existingId = memTgUsers.get(from.id);
  if (existingId && memUsers.has(existingId)) {
    const u = memUsers.get(existingId)!;
    if (from.username !== undefined) u.username = from.username ?? null;
    if (from.first_name) u.firstName = from.first_name;
    return withAdmin({ ...u });
  }

  const id = newId();
  const newUser: User = {
    id,
    tgId: from.id,
    email: null,
    username: from.username ?? null,
    firstName: from.first_name || 'Пользователь',
    createdAt: new Date().toISOString(),
    subscriptionUntil: null,
    planId: null,
  };
  memUsers.set(id, newUser);
  memTgUsers.set(from.id, id);
  return withAdmin({ ...newUser });
}

/**
 * Вход по email-коду: находим пользователя по email или создаём его (tg_id = NULL).
 * Email нормализуется заранее (нижний регистр, trim) в server/auth.ts.
 */
export async function upsertEmailUser(email: string): Promise<User> {
  if (useSupabase) {
    const existing = check(await sb().from('users').select('*').eq('email', email).maybeSingle(), 'upsertEmailUser.find');
    if (existing) return userOf(existing);
    const r = await sb()
      .from('users')
      .insert({ tg_id: null, email, first_name: email.split('@')[0] || 'Пользователь' })
      .select('*')
      .single();
    return userOf(check(r, 'upsertEmailUser'));
  }

  const existingId = memEmailUsers.get(email);
  if (existingId && memUsers.has(existingId)) return withAdmin({ ...memUsers.get(existingId)! });

  const id = newId();
  const newUser: User = {
    id,
    tgId: null,
    email,
    username: null,
    firstName: email.split('@')[0] || 'Пользователь',
    createdAt: new Date().toISOString(),
    subscriptionUntil: null,
    planId: null,
  };
  memUsers.set(id, newUser);
  memEmailUsers.set(email, id);
  return withAdmin({ ...newUser });
}

export const isSubscribed = (u: User) => !!u.subscriptionUntil && Date.parse(u.subscriptionUntil) > Date.now();

/**
 * Коды возможностей, доступных пользователю: админ видит всё, подписчик —
 * возможности своего тарифа (users.plan_id → PLANS[*].features), без тарифа —
 * только base. Гейтятся в /api/app/verify (программа) и /api/training (кабинет).
 */
export async function getActiveFeatures(u: User): Promise<string[]> {
  if (isAdminTg(u.tgId)) return [...ALL_FEATURES];
  if (!isSubscribed(u)) return [];
  if (!u.planId) return ['base'];
  const plans = await getPlans();
  // Подписки, купленные до перехода на Start/PRO/Ultra: month/quarter = уровень Start.
  const planId = u.planId === 'month' || u.planId === 'quarter' ? 'start' : u.planId;
  const plan = plans.find((p) => p.id === planId);
  return plan?.features ?? ['base'];
}

export async function extendSubscription(userId: string, days: number, planId?: string): Promise<User> {
  const u = await getUser(userId);
  if (!u) throw new Error('user not found');
  if (isAdminTg(u.tgId)) return u; // админу продлевать нечего
  const base = isSubscribed(u) ? Date.parse(u.subscriptionUntil!) : Date.now();
  const until = new Date(base + days * 86400000).toISOString();
  const nextPlanId = planId ?? u.planId ?? null;

  if (useSupabase) {
    const patch: Record<string, unknown> = { subscription_until: until };
    if (planId !== undefined) patch.plan_id = nextPlanId;
    const r = await sb().from('users').update(patch).eq('id', userId).select('*').single();
    return userOf(check(r, 'extendSubscription'));
  }

  const updated: User = { ...u, subscriptionUntil: until, planId: nextPlanId };
  memUsers.set(userId, updated);
  return withAdmin({ ...updated });
}

/* ── админ: поиск пользователей и ручное управление подпиской ── */

/** Ищет по числовому Telegram ID или по @username (без учёта регистра). */
export async function findUser(q: string): Promise<User | null> {
  const s = q.trim().replace(/^@/, '');
  if (!s) return null;
  const byId = /^\d+$/.test(s);
  if (useSupabase) {
    const base = sb().from('users').select('*');
    const r = byId
      ? await base.eq('tg_id', Number(s)).maybeSingle()
      : await base.ilike('username', s.replace(/[%_]/g, '\\$&')).limit(1).maybeSingle();
    const row = check(r as any, 'findUser');
    return row ? userOf(row) : null;
  }
  for (const u of memUsers.values()) {
    if (byId ? String(u.tgId) === s : (u.username || '').toLowerCase() === s.toLowerCase()) return withAdmin({ ...u });
  }
  return null;
}

/** Задаёт срок подписки напрямую (null — снять). */
export async function setSubscription(userId: string, until: string | null): Promise<User> {
  if (useSupabase) {
    const r = await sb().from('users').update({ subscription_until: until }).eq('id', userId).select('*').single();
    return userOf(check(r, 'setSubscription'));
  }
  const u = memUsers.get(userId);
  if (!u) throw new Error('user not found');
  u.subscriptionUntil = until;
  return withAdmin({ ...u });
}

export async function listRecentUsers(limit = 10): Promise<User[]> {
  if (useSupabase) {
    const r = await sb().from('users').select('*').order('created_at', { ascending: false }).limit(limit);
    return (check(r, 'listRecentUsers') || []).map(userOf);
  }
  return [...memUsers.values()]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit)
    .map((u) => withAdmin({ ...u }));
}

/* ── токены входа через бота ── */

const TOKEN_MS = 10 * 60_000;

export async function createLoginToken(token: string) {
  if (useSupabase) {
    await sb().from('login_tokens').delete().lt('created_at', ago(TOKEN_MS));
    check(await sb().from('login_tokens').insert({ token }), 'createLoginToken');
    return;
  }
  const now = Date.now();
  for (const [k, v] of memTokens.entries()) {
    if (now - v.createdAt > TOKEN_MS) memTokens.delete(k);
  }
  memTokens.set(token, { token, createdAt: now });
}

export async function getLoginToken(token: string): Promise<LoginToken | null> {
  if (useSupabase) {
    const row = check(await sb().from('login_tokens').select('*').eq('token', token).maybeSingle(), 'getLoginToken');
    if (!row || Date.now() - Date.parse(row.created_at) > TOKEN_MS) return null;
    return { token: row.token, createdAt: Date.parse(row.created_at), userId: row.user_id ?? undefined };
  }
  const entry = memTokens.get(token);
  if (!entry || Date.now() - entry.createdAt > TOKEN_MS) return null;
  return { ...entry };
}

/** Привязывает свежий непривязанный токен к пользователю. false — токен устарел или уже занят. */
export async function bindLoginToken(token: string, userId: string): Promise<boolean> {
  if (useSupabase) {
    const r = await sb()
      .from('login_tokens')
      .update({ user_id: userId })
      .eq('token', token)
      .is('user_id', null)
      .gt('created_at', ago(TOKEN_MS))
      .select('token');
    return (check(r, 'bindLoginToken') || []).length > 0;
  }
  const entry = memTokens.get(token);
  if (!entry || Date.now() - entry.createdAt > TOKEN_MS || entry.userId) return false;
  entry.userId = userId;
  return true;
}

/** Одноразово забирает привязанный токен: возвращает userId или null. */
export async function takeLoginToken(token: string): Promise<string | null> {
  if (useSupabase) {
    const r = await sb().from('login_tokens').delete().eq('token', token).not('user_id', 'is', null).select('user_id');
    const rows = check(r, 'takeLoginToken') || [];
    return rows[0]?.user_id ?? null;
  }
  const entry = memTokens.get(token);
  if (!entry || !entry.userId) return null;
  memTokens.delete(token);
  return entry.userId;
}

/* ── поиски ── */

const SEARCH_COLS = 'id,user_id,kind,created_at,demo,seed,query,stats,rows_total,head';

const searchOf = (r: any): SearchRecord => ({
  id: r.id,
  userId: r.user_id,
  kind: r.kind,
  createdAt: r.created_at,
  demo: r.demo,
  seed: r.seed,
  query: r.query ?? {},
  stats: r.stats ?? {},
  rowsTotal: r.rows_total ?? 0,
  head: r.head ?? undefined,
  rows: r.rows ?? undefined,
});

export async function insertSearch(rec: SearchRecord) {
  if (useSupabase) {
    check(
      await sb().from('searches').insert({
        id: rec.id,
        user_id: rec.userId,
        kind: rec.kind,
        created_at: rec.createdAt,
        demo: rec.demo,
        seed: rec.seed,
        query: rec.query,
        stats: rec.stats,
        rows_total: rec.rowsTotal,
        head: rec.head ?? null,
        rows: rec.rows ?? null,
      }),
      'insertSearch',
    );
    return;
  }
  memSearches.set(rec.id, { ...rec });
}

export async function countSearchesSince(userId: string, sinceMs: number): Promise<number> {
  if (useSupabase) {
    const r = await sb().from('searches').select('id', { count: 'exact', head: true }).eq('user_id', userId).gt('created_at', ago(sinceMs));
    if (r.error) throw new Error(`[db] countSearchesSince: ${r.error.message}`);
    return r.count ?? 0;
  }
  const threshold = Date.now() - sinceMs;
  let count = 0;
  for (const s of memSearches.values()) {
    if (s.userId === userId && Date.parse(s.createdAt) > threshold) count++;
  }
  return count;
}

export async function hasUsedTrial(userId: string, kind: SearchRecord['kind']): Promise<boolean> {
  if (useSupabase) {
    const r = await sb().from('trial_usage').select('user_id').eq('user_id', userId).eq('kind', kind).maybeSingle();
    return !!check(r, 'hasUsedTrial');
  }
  return memTrialUsage.has(`${userId}:${kind}`);
}

/** Атомарно резервирует одноразовый пробный поиск. false означает, что он уже использован. */
export async function claimTrial(userId: string, kind: SearchRecord['kind']): Promise<boolean> {
  if (useSupabase) {
    const r = await sb().from('trial_usage').insert({ user_id: userId, kind }).select('user_id');
    if (r.error?.code === '23505') return false;
    if (r.error) throw new Error(`[db] claimTrial: ${r.error.message}`);
    return (r.data || []).length > 0;
  }
  const key = `${userId}:${kind}`;
  if (memTrialUsage.has(key)) return false;
  memTrialUsage.add(key);
  return true;
}

export async function recentSearches(userId: string, kind: SearchRecord['kind'], sinceMs: number): Promise<SearchRecord[]> {
  if (useSupabase) {
    const r = await sb().from('searches').select(SEARCH_COLS).eq('user_id', userId).eq('kind', kind).gt('created_at', ago(sinceMs)).order('created_at', { ascending: false }).limit(100);
    return (check(r, 'recentSearches') || []).map(searchOf);
  }
  const threshold = Date.now() - sinceMs;
  return Array.from(memSearches.values())
    .filter((s) => s.userId === userId && s.kind === kind && Date.parse(s.createdAt) > threshold)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 100);
}

export async function listSearches(userId: string, kind: SearchRecord['kind'], limit: number): Promise<SearchRecord[]> {
  if (useSupabase) {
    const r = await sb().from('searches').select(SEARCH_COLS).eq('user_id', userId).eq('kind', kind).order('created_at', { ascending: false }).limit(limit);
    return (check(r, 'listSearches') || []).map(searchOf);
  }
  return Array.from(memSearches.values())
    .filter((s) => s.userId === userId && s.kind === kind)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);
}

export async function getSearch(id: string, userId: string, withRows = false): Promise<SearchRecord | null> {
  if (!UUID.test(id)) return null;
  if (useSupabase) {
    const cols = withRows ? SEARCH_COLS + ',rows' : SEARCH_COLS;
    const r = await sb().from('searches').select(cols).eq('id', id).eq('user_id', userId).maybeSingle();
    const row = check(r, 'getSearch');
    return row ? searchOf(row) : null;
  }
  const s = memSearches.get(id);
  if (!s || s.userId !== userId) return null;
  if (!withRows && s.rows) {
    const { rows: _, ...rest } = s;
    return rest as SearchRecord;
  }
  return s;
}

/* ── платежи ── */

const payOf = (r: any): PaymentRecord => ({
  id: r.id,
  userId: r.user_id,
  planId: r.plan_id,
  amountRub: r.amount_rub,
  status: r.status,
  provider: r.provider,
  providerId: r.provider_id,
  createdAt: r.created_at,
  paidAt: r.paid_at,
});

export async function insertPayment(p: PaymentRecord) {
  if (useSupabase) {
    check(
      await sb().from('payments').insert({
        id: p.id, user_id: p.userId, plan_id: p.planId, amount_rub: p.amountRub, status: p.status,
        provider: p.provider, provider_id: p.providerId, created_at: p.createdAt, paid_at: p.paidAt,
      }),
      'insertPayment',
    );
    return;
  }
  memPayments.set(p.id, { ...p });
}

export async function setPaymentProviderId(id: string, providerId: string) {
  if (useSupabase) {
    check(await sb().from('payments').update({ provider_id: providerId }).eq('id', id), 'setPaymentProviderId');
    return;
  }
  const p = memPayments.get(id);
  if (p) p.providerId = providerId;
}

export async function findPaymentByProviderId(providerId: string): Promise<PaymentRecord | null> {
  if (useSupabase) {
    const row = check(await sb().from('payments').select('*').eq('provider_id', providerId).maybeSingle(), 'findPayment');
    return row ? payOf(row) : null;
  }
  for (const p of memPayments.values()) {
    if (p.providerId === providerId) return { ...p };
  }
  return null;
}

export async function cancelPayment(id: string) {
  if (useSupabase) {
    check(await sb().from('payments').update({ status: 'canceled' }).eq('id', id).eq('status', 'pending'), 'cancelPayment');
    return;
  }
  const p = memPayments.get(id);
  if (p && p.status === 'pending') p.status = 'canceled';
}

/** Атомарно переводит платёж pending → succeeded. null — уже обработан (идемпотентность). */
export async function claimPayment(id: string): Promise<PaymentRecord | null> {
  if (useSupabase) {
    const r = await sb().from('payments').update({ status: 'succeeded', paid_at: new Date().toISOString() }).eq('id', id).eq('status', 'pending').select('*');
    const rows = check(r, 'claimPayment') || [];
    return rows[0] ? payOf(rows[0]) : null;
  }
  const p = memPayments.get(id);
  if (p && p.status === 'pending') {
    p.status = 'succeeded';
    p.paidAt = new Date().toISOString();
    return { ...p };
  }
  return null;
}

export async function revertPayment(id: string) {
  if (useSupabase) {
    await sb().from('payments').update({ status: 'pending', paid_at: null }).eq('id', id);
    return;
  }
  const p = memPayments.get(id);
  if (p) {
    p.status = 'pending';
    p.paidAt = null;
  }
}

/* ── лимиты ── */

/** true — можно, false — лимит исчерпан.
 *
 * `failClosed=true` переводит сбой счётчика (например, падение Supabase) в «запретить»,
 * а не в «пропустить». Используется для чувствительных лимитов: `auth:*` (перебор
 * токенов входа) и `app-verify:*` (перебор ключей лицензии). Для прочих оставляем
 * `failClosed=false`, чтобы не блокировать пользователей из-за временного сбоя БД. */
export async function rateLimit(key: string, max: number, windowMs: number, failClosed = false): Promise<boolean> {
  if (useSupabase) {
    const r = await sb().rpc('rate_limit', { p_key: key, p_max: max, p_window_ms: windowMs });
    if (r.error) {
      console.error('[db] rateLimit:', r.error.message);
      return !failClosed;
    }
    return r.data === true;
  }

  const now = Date.now();
  const entry = memLimits.get(key);
  if (!entry || now > entry.resetAt) {
    memLimits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}

/* ── учёт расходов Fracs AI (таблица ai_usage, supabase/ai_usage.sql) ── */

export interface AiUsageDay { userRequests: number; userCostUsd: number; userTokens: number; totalRequests: number; totalCostUsd: number; totalTokens: number }
const memAiUsage = new Map<string, { requests: number; tokens: number; cost: number }>(); // ключ `${день}|${userId}`
const utcDay = () => new Date().toISOString().slice(0, 10);

/** Расходы за текущие сутки (UTC): по пользователю и по всем. Бросает ошибку при сбое — вызывающий закрывает доступ. */
export async function aiUsageToday(userId: string): Promise<AiUsageDay> {
  const day = utcDay();
  const out: AiUsageDay = { userRequests: 0, userCostUsd: 0, userTokens: 0, totalRequests: 0, totalCostUsd: 0, totalTokens: 0 };
  if (useSupabase) {
    const r = await sb().from('ai_usage').select('user_id,requests,tokens,cost_usd').eq('day', day).limit(20000);
    if (r.error) throw new Error(`[db] aiUsageToday: ${r.error.message}`);
    for (const row of r.data ?? []) {
      out.totalRequests += Number(row.requests) || 0;
      out.totalCostUsd += Number(row.cost_usd) || 0;
      out.totalTokens += Number(row.tokens) || 0;
      if (row.user_id === userId) {
        out.userRequests += Number(row.requests) || 0;
        out.userCostUsd += Number(row.cost_usd) || 0;
        out.userTokens += Number(row.tokens) || 0;
      }
    }
    return out;
  }
  for (const [k, v] of memAiUsage) {
    if (!k.startsWith(day + '|')) continue;
    out.totalRequests += v.requests; out.totalCostUsd += v.cost; out.totalTokens += v.tokens;
    if (k === `${day}|${userId}`) { out.userRequests += v.requests; out.userCostUsd += v.cost; out.userTokens += v.tokens; }
  }
  return out;
}

export async function aiUsageAdd(userId: string, tokens: number, costUsd: number): Promise<void> {
  if (useSupabase) {
    const r = await sb().rpc('ai_usage_add', { p_user: userId, p_tokens: Math.round(tokens), p_cost: costUsd });
    if (r.error) throw new Error(`[db] aiUsageAdd: ${r.error.message}`);
    return;
  }
  const k = `${utcDay()}|${userId}`;
  const v = memAiUsage.get(k) ?? { requests: 0, tokens: 0, cost: 0 };
  memAiUsage.set(k, { requests: v.requests + 1, tokens: v.tokens + tokens, cost: v.cost + costUsd });
}

/* ── баланс токенов Fracs AI (таблица ai_tokens, supabase/ai_tokens.sql) ──
   Купленные пакеты — разовая покупка поверх подписки, не истекают с подпиской.
   Расход списывается только в объёме, превышающем дневную включённую квоту. */

const memAiTokens = new Map<string, number>();

/** Остаток купленных токенов пользователя. Бросает ошибку при сбое — вызывающий закрывает доступ. */
export async function aiTokensGet(userId: string): Promise<number> {
  if (useSupabase) {
    const r = await sb().from('ai_tokens').select('balance').eq('user_id', userId).maybeSingle();
    if (r.error) throw new Error(`[db] aiTokensGet: ${r.error.message}`);
    return Math.max(0, Math.round(Number(r.data?.balance) || 0));
  }
  return Math.max(0, Math.round(memAiTokens.get(userId) || 0));
}

export async function aiTokensAdd(userId: string, tokens: number): Promise<void> {
  const n = Math.round(tokens);
  if (n <= 0) return;
  if (useSupabase) {
    const r = await sb().rpc('ai_tokens_add', { p_user: userId, p_tokens: n });
    if (r.error) throw new Error(`[db] aiTokensAdd: ${r.error.message}`);
    return;
  }
  memAiTokens.set(userId, (memAiTokens.get(userId) || 0) + n);
}

/** Списать токены (не уходит в минус). */
export async function aiTokensSpend(userId: string, tokens: number): Promise<void> {
  const n = Math.round(tokens);
  if (n <= 0) return;
  if (useSupabase) {
    const r = await sb().rpc('ai_tokens_spend', { p_user: userId, p_tokens: n });
    if (r.error) throw new Error(`[db] aiTokensSpend: ${r.error.message}`);
    return;
  }
  memAiTokens.set(userId, Math.max(0, (memAiTokens.get(userId) || 0) - n));
}

/* ── демо-страницы (видеообзор по QR), таблица demos — supabase/demos.sql ── */

const memDemos = new Map<string, { userId: string; html: string; at: number }>();
const DEMO_TTL_DAYS = 45;

export async function demoCreate(userId: string, html: string): Promise<string> {
  const id = crypto.randomBytes(9).toString('base64url');
  if (useSupabase) {
    const r = await sb().from('demos').insert({ id, user_id: userId, size: html.length, html });
    if (r.error) throw new Error(`[db] demoCreate: ${r.error.message}`);
    return id;
  }
  memDemos.set(id, { userId, html, at: Date.now() });
  return id;
}

export async function demoGet(id: string): Promise<string | null> {
  if (useSupabase) {
    const r = await sb().from('demos').select('html').eq('id', id).gt('created_at', ago(DEMO_TTL_DAYS * 86400_000)).maybeSingle();
    if (r.error) throw new Error(`[db] demoGet: ${r.error.message}`);
    return r.data?.html ?? null;
  }
  const d = memDemos.get(id);
  return d && Date.now() - d.at < DEMO_TTL_DAYS * 86400_000 ? d.html : null;
}

export async function demoCounts(userId: string): Promise<{ day: number; total: number }> {
  if (useSupabase) {
    const q = (since: number) => sb().from('demos').select('id', { count: 'exact', head: true }).eq('user_id', userId).gt('created_at', ago(since));
    const [d, t] = await Promise.all([q(86400_000), q(DEMO_TTL_DAYS * 86400_000)]);
    if (d.error || t.error) throw new Error(`[db] demoCounts: ${(d.error || t.error)!.message}`);
    return { day: d.count ?? 0, total: t.count ?? 0 };
  }
  let day = 0, total = 0;
  for (const v of memDemos.values()) if (v.userId === userId) { total++; if (Date.now() - v.at < 86400_000) day++; }
  return { day, total };
}

/* ── обслуживание (cron) ── */

export async function cleanup(retentionDays: number) {
  if (useSupabase) {
    const c = sb();
    await c.from('login_tokens').delete().lt('created_at', ago(TOKEN_MS));
    await c.from('rate_limits').delete().lt('reset_at', new Date().toISOString());
    await c.from('searches').delete().lt('created_at', ago(retentionDays * 86400_000));
    await c.from('demos').delete().lt('created_at', ago(DEMO_TTL_DAYS * 86400_000));
    return;
  }
  const now = Date.now();
  for (const [k, v] of memTokens.entries()) {
    if (now - v.createdAt > TOKEN_MS) memTokens.delete(k);
  }
  for (const [k, v] of memLimits.entries()) {
    if (now > v.resetAt) memLimits.delete(k);
  }
  const threshold = now - retentionDays * 86400_000;
  for (const [k, s] of memSearches.entries()) {
    if (Date.parse(s.createdAt) < threshold) memSearches.delete(k);
  }
}

/** Подписки, которые кончаются в ближайшие 3 дня и по которым ещё не напоминали. Админ не в списке. */
export async function usersToRemind(): Promise<(User & { notifiedFor: string | null })[]> {
  const now = new Date().toISOString();
  const soon = new Date(Date.now() + 3 * 86400_000).toISOString();
  if (useSupabase) {
    const r = await sb().from('users').select('*').gt('subscription_until', now).lt('subscription_until', soon);
    return (check(r, 'usersToRemind') || [])
      .filter((x: any) => !isAdminTg(Number(x.tg_id)) && x.expiry_notified_for !== x.subscription_until)
      .map((x: any) => ({ ...userOf(x), notifiedFor: x.expiry_notified_for }));
  }
  const result: (User & { notifiedFor: string | null })[] = [];
  for (const u of memUsers.values()) {
    if (isAdminTg(u.tgId)) continue;
    if (u.subscriptionUntil && u.subscriptionUntil > now && u.subscriptionUntil < soon) {
      const notified = memExpiryNotified.get(u.id) ?? null;
      if (notified !== u.subscriptionUntil) {
        result.push({ ...u, notifiedFor: notified });
      }
    }
  }
  return result;
}

export async function markReminded(userId: string, until: string) {
  if (useSupabase) {
    await sb().from('users').update({ expiry_notified_for: until }).eq('id', userId);
    return;
  }
  memExpiryNotified.set(userId, until);
}

export async function ping(): Promise<boolean> {
  if (useSupabase) {
    const r = await sb().from('users').select('id', { head: true, count: 'exact' }).limit(1);
    return !r.error;
  }
  return true;
}

/* ── тарифы (редактируются через админку в Telegram) ── */

const clonePlans = (list: Plan[]): Plan[] => list.map((p) => ({ ...p }));
const PLANS_FILE = path.join(process.cwd(), 'data', 'plans.json');

let memPlans: Plan[] | null = null;

function loadLocalPlans(): Plan[] {
  if (memPlans) return clonePlans(memPlans);
  try {
    if (fs.existsSync(PLANS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PLANS_FILE, 'utf-8'));
      if (Array.isArray(parsed) && parsed.length) {
        memPlans = parsed;
        return clonePlans(parsed);
      }
    }
  } catch {
    /* ignore */
  }
  memPlans = clonePlans(PLANS);
  return clonePlans(memPlans);
}

function saveLocalPlans(plans: Plan[]) {
  memPlans = clonePlans(plans);
  try {
    fs.mkdirSync(path.dirname(PLANS_FILE), { recursive: true });
    fs.writeFileSync(PLANS_FILE, JSON.stringify(plans, null, 2), 'utf-8');
  } catch {
    /* read-only fs (e.g. serverless) — остаётся в памяти */
  }
}

export async function getPlans(): Promise<Plan[]> {
  if (useSupabase) {
    try {
      const r = await sb().from('app_settings').select('value').eq('key', 'plans').maybeSingle();
      if (!r.error && Array.isArray(r.data?.value) && r.data.value.length) {
        memPlans = clonePlans(r.data.value as Plan[]);
        return clonePlans(memPlans);
      }
    } catch {
      /* таблица может быть ещё не создана — используем кэш/дефолт */
    }
  }
  return loadLocalPlans();
}

export async function savePlans(plans: Plan[]): Promise<void> {
  saveLocalPlans(plans);
  if (useSupabase) {
    const r = await sb()
      .from('app_settings')
      .upsert({ key: 'plans', value: plans, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (r.error) {
      console.warn('[db] savePlans supabase:', r.error.message);
    }
  }
}

export async function findPlan(idOrIndex: string): Promise<Plan | null> {
  const plans = await getPlans();
  const s = idOrIndex.trim().toLowerCase();
  if (/^\d+$/.test(s)) {
    const idx = Number(s) - 1;
    if (idx >= 0 && idx < plans.length) return plans[idx];
  }
  return plans.find((p) => p.id.toLowerCase() === s) ?? null;
}

export async function updatePlan(
  idOrIndex: string,
  patch: Partial<Pick<Plan, 'priceRub' | 'description' | 'title' | 'badge' | 'days'>>,
): Promise<Plan | null> {
  const plans = await getPlans();
  const target = await findPlan(idOrIndex);
  if (!target) return null;
  const next = plans.map((p) => {
    if (p.id !== target.id) return p;
    const updated: Plan = { ...p, ...patch };
    if (!updated.description) delete updated.description;
    if (!updated.badge) delete updated.badge;
    return updated;
  });
  await savePlans(next);
  return next.find((p) => p.id === target.id) ?? null;
}

export async function resetPlans(): Promise<Plan[]> {
  const defaults = clonePlans(PLANS);
  await savePlans(defaults);
  return defaults;
}

/* ── раздел «Обучение»: уроки хранятся в app_settings (key 'training'),
   как тарифы; редактируются через админку в Telegram. ── */

export interface Lesson {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  /** Порядок вывода: меньше — выше. */
  order: number;
}

const TRAINING_FILE = path.join(process.cwd(), 'data', 'training.json');
let memTraining: Lesson[] | null = null;

function cloneTraining(list: Lesson[]): Lesson[] {
  return list.map((l) => ({ ...l }));
}

function loadLocalTraining(): Lesson[] {
  if (memTraining) return cloneTraining(memTraining);
  try {
    if (fs.existsSync(TRAINING_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(TRAINING_FILE, 'utf-8'));
      if (Array.isArray(parsed)) {
        memTraining = parsed;
        return cloneTraining(parsed);
      }
    }
  } catch {
    /* ignore */
  }
  memTraining = [];
  return cloneTraining(memTraining);
}

function saveLocalTraining(lessons: Lesson[]) {
  memTraining = cloneTraining(lessons);
  try {
    fs.mkdirSync(path.dirname(TRAINING_FILE), { recursive: true });
    fs.writeFileSync(TRAINING_FILE, JSON.stringify(lessons, null, 2), 'utf-8');
  } catch {
    /* read-only fs — остаётся в памяти */
  }
}

export async function getTraining(): Promise<Lesson[]> {
  if (useSupabase) {
    try {
      const r = await sb().from('app_settings').select('value').eq('key', 'training').maybeSingle();
      if (!r.error && Array.isArray(r.data?.value)) {
        memTraining = cloneTraining(r.data.value as Lesson[]);
        return cloneTraining(memTraining);
      }
    } catch {
      /* таблицы может не быть — используем кэш/пусто */
    }
  }
  return loadLocalTraining().sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

export async function saveTraining(lessons: Lesson[]): Promise<void> {
  saveLocalTraining(lessons);
  if (useSupabase) {
    const r = await sb()
      .from('app_settings')
      .upsert({ key: 'training', value: lessons, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (r.error) console.warn('[db] saveTraining supabase:', r.error.message);
  }
}

/** Добавляет урок. Заголовок — первая строка, тело — всё после первой пустой строки. */
export async function addLesson(title: string, body: string): Promise<Lesson> {
  const lessons = await getTraining();
  const lesson: Lesson = {
    id: newId(),
    title: title.slice(0, 200),
    body: body.slice(0, 20000),
    createdAt: new Date().toISOString(),
    order: lessons.length ? Math.max(...lessons.map((l) => l.order)) + 1 : 0,
  };
  lessons.push(lesson);
  await saveTraining(lessons);
  return lesson;
}

export async function updateLesson(id: string, patch: Partial<Pick<Lesson, 'title' | 'body'>>): Promise<Lesson | null> {
  const lessons = await getTraining();
  const target = lessons.find((l) => l.id === id || l.id.startsWith(id));
  if (!target) return null;
  if (patch.title !== undefined) target.title = patch.title.slice(0, 200);
  if (patch.body !== undefined) target.body = patch.body.slice(0, 20000);
  await saveTraining(lessons);
  return target;
}

export async function deleteLesson(id: string): Promise<boolean> {
  const lessons = await getTraining();
  const next = lessons.filter((l) => !(l.id === id || l.id.startsWith(id)));
  if (next.length === lessons.length) return false;
  await saveTraining(next);
  return true;
}

/* ── обязательные каналы (REQUIRED_CHANNELS): хранятся в app_settings
   (key 'required_channels') и редактируются из админки. До первой записи
   или при недоступной БД берётся fallback из env REQUIRED_CHANNELS.
   Кэш in-memory на 60с — refresh при setRequiredChannels и по TTL. ── */

let _channelsCache: { at: number; list: string[] } | null = null;
const CHANNELS_TTL = 60_000;

function normalizeChannels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const s = String(item).trim().replace(/^@/, '');
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** Текущий список обязательных каналов (из БД, иначе из env). */
export async function getRequiredChannels(): Promise<string[]> {
  if (_channelsCache && Date.now() - _channelsCache.at < CHANNELS_TTL) return _channelsCache.list;
  let list: string[] = [];
  if (useSupabase) {
    try {
      const r = await sb().from('app_settings').select('value').eq('key', 'required_channels').maybeSingle();
      if (!r.error && r.data?.value) {
        const v = typeof r.data.value === 'string' ? JSON.parse(r.data.value) : r.data.value;
        list = normalizeChannels(v);
      }
    } catch {
      /* таблицы/ключа может не быть — fallback к env */
    }
  }
  if (!list.length) list = config.requiredChannels.slice();
  _channelsCache = { at: Date.now(), list };
  return list;
}

/** Сохранить список обязательных каналов из админки. Возвращает нормализованный список. */
export async function setRequiredChannels(input: string[]): Promise<string[]> {
  const clean = normalizeChannels(input);
  if (useSupabase) {
    try {
      const r = await sb()
        .from('app_settings')
        .upsert({ key: 'required_channels', value: clean, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (r.error) console.warn('[db] setRequiredChannels supabase:', r.error.message);
    } catch (e: any) {
      console.warn('[db] setRequiredChannels:', e?.message || e);
    }
  }
  _channelsCache = { at: Date.now(), list: clean };
  return clean;
}
