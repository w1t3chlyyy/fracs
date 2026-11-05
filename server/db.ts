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

function check<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`[db] ${what}: ${r.error.message}`);
  return r.data;
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
  const r = await sb().from('users').select('*').eq('id', id).maybeSingle();
  const row = check(r, 'getUser');
  return row ? userOf(row) : null;
}

export async function upsertTgUser(from: { id: number; username?: string; first_name?: string }): Promise<User> {
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

export const isSubscribed = (u: User) => !!u.subscriptionUntil && Date.parse(u.subscriptionUntil) > Date.now();

export async function extendSubscription(userId: string, days: number): Promise<User> {
  const u = await getUser(userId);
  if (!u) throw new Error('user not found');
  const base = isSubscribed(u) ? Date.parse(u.subscriptionUntil!) : Date.now();
  const until = new Date(base + days * 86400000).toISOString();
  const r = await sb().from('users').update({ subscription_until: until }).eq('id', userId).select('*').single();
  return userOf(check(r, 'extendSubscription'));
}

/* ── токены входа через бота ── */

const TOKEN_MS = 10 * 60_000;

export async function createLoginToken(token: string) {
  await sb().from('login_tokens').delete().lt('created_at', ago(TOKEN_MS));
  check(await sb().from('login_tokens').insert({ token }), 'createLoginToken');
}

export async function getLoginToken(token: string): Promise<LoginToken | null> {
  const row = check(await sb().from('login_tokens').select('*').eq('token', token).maybeSingle(), 'getLoginToken');
  if (!row || Date.now() - Date.parse(row.created_at) > TOKEN_MS) return null;
  return { token: row.token, createdAt: Date.parse(row.created_at), userId: row.user_id ?? undefined };
}

/** Привязывает свежий непривязанный токен к пользователю. false — токен устарел или уже занят. */
export async function bindLoginToken(token: string, userId: string): Promise<boolean> {
  const r = await sb()
    .from('login_tokens')
    .update({ user_id: userId })
    .eq('token', token)
    .is('user_id', null)
    .gt('created_at', ago(TOKEN_MS))
    .select('token');
  return check(r, 'bindLoginToken').length > 0;
}

/** Одноразово забирает привязанный токен: возвращает userId или null. */
export async function takeLoginToken(token: string): Promise<string | null> {
  const r = await sb().from('login_tokens').delete().eq('token', token).not('user_id', 'is', null).select('user_id');
  const rows = check(r, 'takeLoginToken');
  return rows[0]?.user_id ?? null;
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
}

export async function countSearchesSince(userId: string, sinceMs: number): Promise<number> {
  const r = await sb().from('searches').select('id', { count: 'exact', head: true }).eq('user_id', userId).gt('created_at', ago(sinceMs));
  if (r.error) throw new Error(`[db] countSearchesSince: ${r.error.message}`);
  return r.count ?? 0;
}

export async function recentSearches(userId: string, kind: SearchRecord['kind'], sinceMs: number): Promise<SearchRecord[]> {
  const r = await sb().from('searches').select(SEARCH_COLS).eq('user_id', userId).eq('kind', kind).gt('created_at', ago(sinceMs)).order('created_at', { ascending: false }).limit(100);
  return check(r, 'recentSearches').map(searchOf);
}

export async function listSearches(userId: string, kind: SearchRecord['kind'], limit: number): Promise<SearchRecord[]> {
  const r = await sb().from('searches').select(SEARCH_COLS).eq('user_id', userId).eq('kind', kind).order('created_at', { ascending: false }).limit(limit);
  return check(r, 'listSearches').map(searchOf);
}

export async function getSearch(id: string, userId: string, withRows = false): Promise<SearchRecord | null> {
  if (!UUID.test(id)) return null;
  const cols = withRows ? SEARCH_COLS + ',rows' : SEARCH_COLS;
  const r = await sb().from('searches').select(cols).eq('id', id).eq('user_id', userId).maybeSingle();
  const row = check(r, 'getSearch');
  return row ? searchOf(row) : null;
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
  check(
    await sb().from('payments').insert({
      id: p.id, user_id: p.userId, plan_id: p.planId, amount_rub: p.amountRub, status: p.status,
      provider: p.provider, provider_id: p.providerId, created_at: p.createdAt, paid_at: p.paidAt,
    }),
    'insertPayment',
  );
}

export async function setPaymentProviderId(id: string, providerId: string) {
  check(await sb().from('payments').update({ provider_id: providerId }).eq('id', id), 'setPaymentProviderId');
}

export async function findPaymentByProviderId(providerId: string): Promise<PaymentRecord | null> {
  const row = check(await sb().from('payments').select('*').eq('provider_id', providerId).maybeSingle(), 'findPayment');
  return row ? payOf(row) : null;
}

export async function cancelPayment(id: string) {
  check(await sb().from('payments').update({ status: 'canceled' }).eq('id', id).eq('status', 'pending'), 'cancelPayment');
}

/** Атомарно переводит платёж pending → succeeded. null — уже обработан (идемпотентность). */
export async function claimPayment(id: string): Promise<PaymentRecord | null> {
  const r = await sb().from('payments').update({ status: 'succeeded', paid_at: new Date().toISOString() }).eq('id', id).eq('status', 'pending').select('*');
  const rows = check(r, 'claimPayment');
  return rows[0] ? payOf(rows[0]) : null;
}

export async function revertPayment(id: string) {
  await sb().from('payments').update({ status: 'pending', paid_at: null }).eq('id', id);
}

/* ── лимиты ── */

/** true — можно, false — лимит исчерпан. Счётчик общий для всех инстансов (SQL-функция rate_limit). */
export async function rateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  const r = await sb().rpc('rate_limit', { p_key: key, p_max: max, p_window_ms: windowMs });
  if (r.error) {
    console.error('[db] rateLimit:', r.error.message);
    return true; // не блокируем пользователей из-за сбоя счётчика
  }
  return r.data === true;
}

/* ── обслуживание (cron) ── */

export async function cleanup(retentionDays: number) {
  const c = sb();
  await c.from('login_tokens').delete().lt('created_at', ago(TOKEN_MS));
  await c.from('rate_limits').delete().lt('reset_at', new Date().toISOString());
  await c.from('searches').delete().lt('created_at', ago(retentionDays * 86400_000));
}

/** Подписки, которые кончаются в ближайшие 3 дня и по которым ещё не напоминали. */
export async function usersToRemind(): Promise<(User & { notifiedFor: string | null })[]> {
  const now = new Date().toISOString();
  const soon = new Date(Date.now() + 3 * 86400_000).toISOString();
  const r = await sb().from('users').select('*').gt('subscription_until', now).lt('subscription_until', soon);
  return check(r, 'usersToRemind')
    .filter((x: any) => x.expiry_notified_for !== x.subscription_until)
    .map((x: any) => ({ ...userOf(x), notifiedFor: x.expiry_notified_for }));
}

export async function markReminded(userId: string, until: string) {
  await sb().from('users').update({ expiry_notified_for: until }).eq('id', userId);
}

export async function ping(): Promise<boolean> {
  const r = await sb().from('users').select('id', { head: true, count: 'exact' }).limit(1);
  return !r.error;
}
