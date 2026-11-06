import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
const memTokens = new Map<string, { token: string; createdAt: number; userId?: string }>();
const memSearches = new Map<string, SearchRecord>();
const memPayments = new Map<string, PaymentRecord>();
const memLimits = new Map<string, { count: number; resetAt: number }>();
const memExpiryNotified = new Map<string, string>();

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

const userOf = (r: any): User => ({
  id: r.id,
  tgId: Number(r.tg_id),
  username: r.username,
  firstName: r.first_name,
  createdAt: r.created_at,
  subscriptionUntil: r.subscription_until,
});

export async function getUser(id: string): Promise<User | null> {
  if (!UUID.test(id)) return null;
  if (useSupabase) {
    const r = await sb().from('users').select('*').eq('id', id).maybeSingle();
    const row = check(r, 'getUser');
    return row ? userOf(row) : null;
  }
  return memUsers.get(id) ?? null;
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
    return { ...u };
  }

  const id = newId();
  const newUser: User = {
    id,
    tgId: from.id,
    username: from.username ?? null,
    firstName: from.first_name || 'Пользователь',
    createdAt: new Date().toISOString(),
    subscriptionUntil: null,
  };
  memUsers.set(id, newUser);
  memTgUsers.set(from.id, id);
  return { ...newUser };
}

export const isSubscribed = (u: User) => !!u.subscriptionUntil && Date.parse(u.subscriptionUntil) > Date.now();

export async function extendSubscription(userId: string, days: number): Promise<User> {
  const u = await getUser(userId);
  if (!u) throw new Error('user not found');
  const base = isSubscribed(u) ? Date.parse(u.subscriptionUntil!) : Date.now();
  const until = new Date(base + days * 86400000).toISOString();

  if (useSupabase) {
    const r = await sb().from('users').update({ subscription_until: until }).eq('id', userId).select('*').single();
    return userOf(check(r, 'extendSubscription'));
  }

  const updated: User = { ...u, subscriptionUntil: until };
  memUsers.set(userId, updated);
  return updated;
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

/** true — можно, false — лимит исчерпан. */
export async function rateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  if (useSupabase) {
    const r = await sb().rpc('rate_limit', { p_key: key, p_max: max, p_window_ms: windowMs });
    if (r.error) {
      console.error('[db] rateLimit:', r.error.message);
      return true; // не блокируем пользователей из-за сбоя счётчика
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

/* ── обслуживание (cron) ── */

export async function cleanup(retentionDays: number) {
  if (useSupabase) {
    const c = sb();
    await c.from('login_tokens').delete().lt('created_at', ago(TOKEN_MS));
    await c.from('rate_limits').delete().lt('reset_at', new Date().toISOString());
    await c.from('searches').delete().lt('created_at', ago(retentionDays * 86400_000));
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

/** Подписки, которые кончаются в ближайшие 3 дня и по которым ещё не напоминали. */
export async function usersToRemind(): Promise<(User & { notifiedFor: string | null })[]> {
  const now = new Date().toISOString();
  const soon = new Date(Date.now() + 3 * 86400_000).toISOString();
  if (useSupabase) {
    const r = await sb().from('users').select('*').gt('subscription_until', now).lt('subscription_until', soon);
    return (check(r, 'usersToRemind') || [])
      .filter((x: any) => x.expiry_notified_for !== x.subscription_until)
      .map((x: any) => ({ ...userOf(x), notifiedFor: x.expiry_notified_for }));
  }
  const result: (User & { notifiedFor: string | null })[] = [];
  for (const u of memUsers.values()) {
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
