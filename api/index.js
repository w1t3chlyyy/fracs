// server/app.ts
import express from "express";

// server/auth.ts
import crypto4 from "node:crypto";
import { Router } from "express";

// server/config.ts
import crypto from "node:crypto";
import "dotenv/config";
var env = process.env;
var isProd = env.NODE_ENV === "production";
var port = Number(env.PORT || 3e3);
var vercelUrl = env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "";
var config = {
  isProd,
  port,
  appUrl: (env.APP_URL || vercelUrl || `http://localhost:${port}`).replace(/\/$/, ""),
  sessionSecret: env.SESSION_SECRET || (isProd ? crypto.randomBytes(32).toString("hex") : "dev-secret-change-me"),
  supabaseUrl: env.SUPABASE_URL || "",
  supabaseKey: env.SUPABASE_SERVICE_ROLE_KEY || "",
  cronSecret: env.CRON_SECRET || "",
  searchRetentionDays: Number(env.SEARCH_RETENTION_DAYS || 30),
  botToken: env.TELEGRAM_BOT_TOKEN || "",
  botUsername: (env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, ""),
  // На Vercel работает только webhook. polling — для локальной разработки.
  botMode: env.TELEGRAM_BOT_MODE === "webhook" ? "webhook" : "polling",
  webhookSecret: env.TELEGRAM_WEBHOOK_SECRET || "",
  // Вход без бота — только для локальной разработки (или если явно включено).
  devLogin: env.ALLOW_DEV_LOGIN === "true" || !isProd && !env.TELEGRAM_BOT_TOKEN,
  mapsProvider: env.MAPS_PROVIDER || "mock",
  gisKey: env.GIS_API_KEY || "",
  mapsWorkerUrl: (env.MAPS_WORKER_URL || "").replace(/\/$/, ""),
  mapsWorkerToken: env.MAPS_WORKER_TOKEN || "",
  tgProvider: env.TG_PROVIDER || "mock",
  tgParserUrl: (env.TG_PARSER_URL || "").replace(/\/$/, ""),
  tgParserKey: env.TG_PARSER_KEY || "",
  paymentProvider: env.PAYMENT_PROVIDER || "mock",
  allowMockPayments: !isProd || env.ALLOW_MOCK_PAYMENTS === "true",
  yookassaShopId: env.YOOKASSA_SHOP_ID || "",
  yookassaSecret: env.YOOKASSA_SECRET_KEY || "",
  dailySearchLimit: Number(env.DAILY_SEARCH_LIMIT || 40),
  // Telegram ID админа (число, не @username): подписка ему не нужна, всё открыто.
  adminTgId: Number(env.ADMIN_TG_ID) || 0,
  // @username админа: кнопка оплаты в кабинете ведёт в чат с ним (t.me/<username>).
  adminUsername: (env.ADMIN_TG_USERNAME || "").replace(/^@/, "")
};
if (isProd && !env.SESSION_SECRET) {
  console.warn("[config] SESSION_SECRET \u043D\u0435 \u0437\u0430\u0434\u0430\u043D \u2014 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u044B\u0439 \u043A\u043B\u044E\u0447 \u0441\u0435\u0441\u0441\u0438\u0438.");
}
var PLANS = [
  {
    id: "month",
    title: "1 \u043C\u0435\u0441\u044F\u0446",
    days: 30,
    priceRub: 1800,
    description: "\u0414\u043E\u0441\u0442\u0443\u043F \u043A \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0435 Fracs Parser, \u0431\u0430\u0437\u0435 \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u043E\u0432 \u0438 \u0432\u044B\u0433\u0440\u0443\u0437\u043A\u0430\u043C \u043D\u0430 30 \u0434\u043D\u0435\u0439."
  },
  {
    id: "quarter",
    title: "3 \u043C\u0435\u0441\u044F\u0446\u0430",
    days: 90,
    priceRub: 4500,
    badge: "\u0412\u044B\u0433\u043E\u0434\u043D\u0435\u0435 \u043D\u0430 17%",
    description: "\u0414\u043E\u0441\u0442\u0443\u043F \u043D\u0430 90 \u0434\u043D\u0435\u0439: \u044D\u043A\u043E\u043D\u043E\u043C\u0438\u044F 900 \u20BD \u043F\u0440\u0438 \u043E\u043F\u043B\u0430\u0442\u0435 \u0441\u0440\u0430\u0437\u0443 \u0437\u0430 \u043A\u0432\u0430\u0440\u0442\u0430\u043B."
  }
];

// server/db.ts
import crypto2 from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
var useSupabase = Boolean(config.supabaseUrl && config.supabaseKey);
var client = null;
function sb() {
  if (!client) {
    if (!config.supabaseUrl || !config.supabaseKey) {
      throw new Error("\u041D\u0435 \u0437\u0430\u0434\u0430\u043D\u044B SUPABASE_URL \u0438 SUPABASE_SERVICE_ROLE_KEY");
    }
    client = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return client;
}
var memUsers = /* @__PURE__ */ new Map();
var memTgUsers = /* @__PURE__ */ new Map();
var memTokens = /* @__PURE__ */ new Map();
var memSearches = /* @__PURE__ */ new Map();
var memPayments = /* @__PURE__ */ new Map();
var memLimits = /* @__PURE__ */ new Map();
var memExpiryNotified = /* @__PURE__ */ new Map();
var memTrialUsage = /* @__PURE__ */ new Set();
function check(r, what) {
  if (r.error) throw new Error(`[db] ${what}: ${r.error.message}`);
  return r.data;
}
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var ago = (ms) => new Date(Date.now() - ms).toISOString();
var newId = () => crypto2.randomUUID();
var ADMIN_UNTIL = "2099-12-31T00:00:00.000Z";
var isAdminTg = (tgId) => config.adminTgId > 0 && tgId === config.adminTgId;
function withAdmin(u) {
  return isAdminTg(u.tgId) ? { ...u, subscriptionUntil: ADMIN_UNTIL } : u;
}
var userOf = (r) => withAdmin({
  id: r.id,
  tgId: Number(r.tg_id),
  username: r.username,
  firstName: r.first_name,
  createdAt: r.created_at,
  subscriptionUntil: r.subscription_until
});
async function getUser(id) {
  if (!UUID.test(id)) return null;
  if (useSupabase) {
    const r = await sb().from("users").select("*").eq("id", id).maybeSingle();
    const row = check(r, "getUser");
    return row ? userOf(row) : null;
  }
  const mu = memUsers.get(id);
  return mu ? withAdmin({ ...mu }) : null;
}
async function upsertTgUser(from) {
  if (useSupabase) {
    const existing = check(await sb().from("users").select("first_name").eq("tg_id", from.id).maybeSingle(), "upsertTgUser.find");
    const r = await sb().from("users").upsert(
      { tg_id: from.id, username: from.username ?? null, first_name: from.first_name || existing?.first_name || "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C" },
      { onConflict: "tg_id" }
    ).select("*").single();
    return userOf(check(r, "upsertTgUser"));
  }
  const existingId = memTgUsers.get(from.id);
  if (existingId && memUsers.has(existingId)) {
    const u = memUsers.get(existingId);
    if (from.username !== void 0) u.username = from.username ?? null;
    if (from.first_name) u.firstName = from.first_name;
    return withAdmin({ ...u });
  }
  const id = newId();
  const newUser = {
    id,
    tgId: from.id,
    username: from.username ?? null,
    firstName: from.first_name || "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C",
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    subscriptionUntil: null
  };
  memUsers.set(id, newUser);
  memTgUsers.set(from.id, id);
  return withAdmin({ ...newUser });
}
var isSubscribed = (u) => !!u.subscriptionUntil && Date.parse(u.subscriptionUntil) > Date.now();
async function extendSubscription(userId, days) {
  const u = await getUser(userId);
  if (!u) throw new Error("user not found");
  if (isAdminTg(u.tgId)) return u;
  const base = isSubscribed(u) ? Date.parse(u.subscriptionUntil) : Date.now();
  const until = new Date(base + days * 864e5).toISOString();
  if (useSupabase) {
    const r = await sb().from("users").update({ subscription_until: until }).eq("id", userId).select("*").single();
    return userOf(check(r, "extendSubscription"));
  }
  const updated = { ...u, subscriptionUntil: until };
  memUsers.set(userId, updated);
  return withAdmin({ ...updated });
}
async function findUser(q) {
  const s = q.trim().replace(/^@/, "");
  if (!s) return null;
  const byId = /^\d+$/.test(s);
  if (useSupabase) {
    const base = sb().from("users").select("*");
    const r = byId ? await base.eq("tg_id", Number(s)).maybeSingle() : await base.ilike("username", s.replace(/[%_]/g, "\\$&")).limit(1).maybeSingle();
    const row = check(r, "findUser");
    return row ? userOf(row) : null;
  }
  for (const u of memUsers.values()) {
    if (byId ? String(u.tgId) === s : (u.username || "").toLowerCase() === s.toLowerCase()) return withAdmin({ ...u });
  }
  return null;
}
async function setSubscription(userId, until) {
  if (useSupabase) {
    const r = await sb().from("users").update({ subscription_until: until }).eq("id", userId).select("*").single();
    return userOf(check(r, "setSubscription"));
  }
  const u = memUsers.get(userId);
  if (!u) throw new Error("user not found");
  u.subscriptionUntil = until;
  return withAdmin({ ...u });
}
async function listRecentUsers(limit = 10) {
  if (useSupabase) {
    const r = await sb().from("users").select("*").order("created_at", { ascending: false }).limit(limit);
    return (check(r, "listRecentUsers") || []).map(userOf);
  }
  return [...memUsers.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, limit).map((u) => withAdmin({ ...u }));
}
var TOKEN_MS = 10 * 6e4;
async function createLoginToken(token) {
  if (useSupabase) {
    await sb().from("login_tokens").delete().lt("created_at", ago(TOKEN_MS));
    check(await sb().from("login_tokens").insert({ token }), "createLoginToken");
    return;
  }
  const now = Date.now();
  for (const [k, v] of memTokens.entries()) {
    if (now - v.createdAt > TOKEN_MS) memTokens.delete(k);
  }
  memTokens.set(token, { token, createdAt: now });
}
async function getLoginToken(token) {
  if (useSupabase) {
    const row = check(await sb().from("login_tokens").select("*").eq("token", token).maybeSingle(), "getLoginToken");
    if (!row || Date.now() - Date.parse(row.created_at) > TOKEN_MS) return null;
    return { token: row.token, createdAt: Date.parse(row.created_at), userId: row.user_id ?? void 0 };
  }
  const entry = memTokens.get(token);
  if (!entry || Date.now() - entry.createdAt > TOKEN_MS) return null;
  return { ...entry };
}
async function bindLoginToken(token, userId) {
  if (useSupabase) {
    const r = await sb().from("login_tokens").update({ user_id: userId }).eq("token", token).is("user_id", null).gt("created_at", ago(TOKEN_MS)).select("token");
    return (check(r, "bindLoginToken") || []).length > 0;
  }
  const entry = memTokens.get(token);
  if (!entry || Date.now() - entry.createdAt > TOKEN_MS || entry.userId) return false;
  entry.userId = userId;
  return true;
}
async function takeLoginToken(token) {
  if (useSupabase) {
    const r = await sb().from("login_tokens").delete().eq("token", token).not("user_id", "is", null).select("user_id");
    const rows = check(r, "takeLoginToken") || [];
    return rows[0]?.user_id ?? null;
  }
  const entry = memTokens.get(token);
  if (!entry || !entry.userId) return null;
  memTokens.delete(token);
  return entry.userId;
}
var SEARCH_COLS = "id,user_id,kind,created_at,demo,seed,query,stats,rows_total,head";
var searchOf = (r) => ({
  id: r.id,
  userId: r.user_id,
  kind: r.kind,
  createdAt: r.created_at,
  demo: r.demo,
  seed: r.seed,
  query: r.query ?? {},
  stats: r.stats ?? {},
  rowsTotal: r.rows_total ?? 0,
  head: r.head ?? void 0,
  rows: r.rows ?? void 0
});
async function insertSearch(rec) {
  if (useSupabase) {
    check(
      await sb().from("searches").insert({
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
        rows: rec.rows ?? null
      }),
      "insertSearch"
    );
    return;
  }
  memSearches.set(rec.id, { ...rec });
}
async function countSearchesSince(userId, sinceMs) {
  if (useSupabase) {
    const r = await sb().from("searches").select("id", { count: "exact", head: true }).eq("user_id", userId).gt("created_at", ago(sinceMs));
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
async function hasUsedTrial(userId, kind) {
  if (useSupabase) {
    const r = await sb().from("trial_usage").select("user_id").eq("user_id", userId).eq("kind", kind).maybeSingle();
    return !!check(r, "hasUsedTrial");
  }
  return memTrialUsage.has(`${userId}:${kind}`);
}
async function claimTrial(userId, kind) {
  if (useSupabase) {
    const r = await sb().from("trial_usage").insert({ user_id: userId, kind }).select("user_id");
    if (r.error?.code === "23505") return false;
    if (r.error) throw new Error(`[db] claimTrial: ${r.error.message}`);
    return (r.data || []).length > 0;
  }
  const key = `${userId}:${kind}`;
  if (memTrialUsage.has(key)) return false;
  memTrialUsage.add(key);
  return true;
}
async function recentSearches(userId, kind, sinceMs) {
  if (useSupabase) {
    const r = await sb().from("searches").select(SEARCH_COLS).eq("user_id", userId).eq("kind", kind).gt("created_at", ago(sinceMs)).order("created_at", { ascending: false }).limit(100);
    return (check(r, "recentSearches") || []).map(searchOf);
  }
  const threshold = Date.now() - sinceMs;
  return Array.from(memSearches.values()).filter((s) => s.userId === userId && s.kind === kind && Date.parse(s.createdAt) > threshold).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 100);
}
async function listSearches(userId, kind, limit) {
  if (useSupabase) {
    const r = await sb().from("searches").select(SEARCH_COLS).eq("user_id", userId).eq("kind", kind).order("created_at", { ascending: false }).limit(limit);
    return (check(r, "listSearches") || []).map(searchOf);
  }
  return Array.from(memSearches.values()).filter((s) => s.userId === userId && s.kind === kind).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, limit);
}
async function getSearch(id, userId, withRows = false) {
  if (!UUID.test(id)) return null;
  if (useSupabase) {
    const cols = withRows ? SEARCH_COLS + ",rows" : SEARCH_COLS;
    const r = await sb().from("searches").select(cols).eq("id", id).eq("user_id", userId).maybeSingle();
    const row = check(r, "getSearch");
    return row ? searchOf(row) : null;
  }
  const s = memSearches.get(id);
  if (!s || s.userId !== userId) return null;
  if (!withRows && s.rows) {
    const { rows: _, ...rest } = s;
    return rest;
  }
  return s;
}
var payOf = (r) => ({
  id: r.id,
  userId: r.user_id,
  planId: r.plan_id,
  amountRub: r.amount_rub,
  status: r.status,
  provider: r.provider,
  providerId: r.provider_id,
  createdAt: r.created_at,
  paidAt: r.paid_at
});
async function insertPayment(p) {
  if (useSupabase) {
    check(
      await sb().from("payments").insert({
        id: p.id,
        user_id: p.userId,
        plan_id: p.planId,
        amount_rub: p.amountRub,
        status: p.status,
        provider: p.provider,
        provider_id: p.providerId,
        created_at: p.createdAt,
        paid_at: p.paidAt
      }),
      "insertPayment"
    );
    return;
  }
  memPayments.set(p.id, { ...p });
}
async function setPaymentProviderId(id, providerId) {
  if (useSupabase) {
    check(await sb().from("payments").update({ provider_id: providerId }).eq("id", id), "setPaymentProviderId");
    return;
  }
  const p = memPayments.get(id);
  if (p) p.providerId = providerId;
}
async function findPaymentByProviderId(providerId) {
  if (useSupabase) {
    const row = check(await sb().from("payments").select("*").eq("provider_id", providerId).maybeSingle(), "findPayment");
    return row ? payOf(row) : null;
  }
  for (const p of memPayments.values()) {
    if (p.providerId === providerId) return { ...p };
  }
  return null;
}
async function cancelPayment(id) {
  if (useSupabase) {
    check(await sb().from("payments").update({ status: "canceled" }).eq("id", id).eq("status", "pending"), "cancelPayment");
    return;
  }
  const p = memPayments.get(id);
  if (p && p.status === "pending") p.status = "canceled";
}
async function claimPayment(id) {
  if (useSupabase) {
    const r = await sb().from("payments").update({ status: "succeeded", paid_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", id).eq("status", "pending").select("*");
    const rows = check(r, "claimPayment") || [];
    return rows[0] ? payOf(rows[0]) : null;
  }
  const p = memPayments.get(id);
  if (p && p.status === "pending") {
    p.status = "succeeded";
    p.paidAt = (/* @__PURE__ */ new Date()).toISOString();
    return { ...p };
  }
  return null;
}
async function revertPayment(id) {
  if (useSupabase) {
    await sb().from("payments").update({ status: "pending", paid_at: null }).eq("id", id);
    return;
  }
  const p = memPayments.get(id);
  if (p) {
    p.status = "pending";
    p.paidAt = null;
  }
}
async function rateLimit(key, max, windowMs) {
  if (useSupabase) {
    const r = await sb().rpc("rate_limit", { p_key: key, p_max: max, p_window_ms: windowMs });
    if (r.error) {
      console.error("[db] rateLimit:", r.error.message);
      return true;
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
async function cleanup(retentionDays) {
  if (useSupabase) {
    const c = sb();
    await c.from("login_tokens").delete().lt("created_at", ago(TOKEN_MS));
    await c.from("rate_limits").delete().lt("reset_at", (/* @__PURE__ */ new Date()).toISOString());
    await c.from("searches").delete().lt("created_at", ago(retentionDays * 864e5));
    return;
  }
  const now = Date.now();
  for (const [k, v] of memTokens.entries()) {
    if (now - v.createdAt > TOKEN_MS) memTokens.delete(k);
  }
  for (const [k, v] of memLimits.entries()) {
    if (now > v.resetAt) memLimits.delete(k);
  }
  const threshold = now - retentionDays * 864e5;
  for (const [k, s] of memSearches.entries()) {
    if (Date.parse(s.createdAt) < threshold) memSearches.delete(k);
  }
}
async function usersToRemind() {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const soon = new Date(Date.now() + 3 * 864e5).toISOString();
  if (useSupabase) {
    const r = await sb().from("users").select("*").gt("subscription_until", now).lt("subscription_until", soon);
    return (check(r, "usersToRemind") || []).filter((x) => !isAdminTg(Number(x.tg_id)) && x.expiry_notified_for !== x.subscription_until).map((x) => ({ ...userOf(x), notifiedFor: x.expiry_notified_for }));
  }
  const result = [];
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
async function markReminded(userId, until) {
  if (useSupabase) {
    await sb().from("users").update({ expiry_notified_for: until }).eq("id", userId);
    return;
  }
  memExpiryNotified.set(userId, until);
}
async function ping() {
  if (useSupabase) {
    const r = await sb().from("users").select("id", { head: true, count: "exact" }).limit(1);
    return !r.error;
  }
  return true;
}
var clonePlans = (list) => list.map((p) => ({ ...p }));
var PLANS_FILE = path.join(process.cwd(), "data", "plans.json");
var memPlans = null;
function loadLocalPlans() {
  if (memPlans) return clonePlans(memPlans);
  try {
    if (fs.existsSync(PLANS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PLANS_FILE, "utf-8"));
      if (Array.isArray(parsed) && parsed.length) {
        memPlans = parsed;
        return clonePlans(parsed);
      }
    }
  } catch {
  }
  memPlans = clonePlans(PLANS);
  return clonePlans(memPlans);
}
function saveLocalPlans(plans) {
  memPlans = clonePlans(plans);
  try {
    fs.mkdirSync(path.dirname(PLANS_FILE), { recursive: true });
    fs.writeFileSync(PLANS_FILE, JSON.stringify(plans, null, 2), "utf-8");
  } catch {
  }
}
async function getPlans() {
  if (useSupabase) {
    try {
      const r = await sb().from("app_settings").select("value").eq("key", "plans").maybeSingle();
      if (!r.error && Array.isArray(r.data?.value) && r.data.value.length) {
        memPlans = clonePlans(r.data.value);
        return clonePlans(memPlans);
      }
    } catch {
    }
  }
  return loadLocalPlans();
}
async function savePlans(plans) {
  saveLocalPlans(plans);
  if (useSupabase) {
    const r = await sb().from("app_settings").upsert({ key: "plans", value: plans, updated_at: (/* @__PURE__ */ new Date()).toISOString() }, { onConflict: "key" });
    if (r.error) {
      console.warn("[db] savePlans supabase:", r.error.message);
    }
  }
}
async function findPlan(idOrIndex) {
  const plans = await getPlans();
  const s = idOrIndex.trim().toLowerCase();
  if (/^\d+$/.test(s)) {
    const idx = Number(s) - 1;
    if (idx >= 0 && idx < plans.length) return plans[idx];
  }
  return plans.find((p) => p.id.toLowerCase() === s) ?? null;
}
async function updatePlan(idOrIndex, patch) {
  const plans = await getPlans();
  const target = await findPlan(idOrIndex);
  if (!target) return null;
  const next = plans.map((p) => {
    if (p.id !== target.id) return p;
    const updated = { ...p, ...patch };
    if (!updated.description) delete updated.description;
    if (!updated.badge) delete updated.badge;
    return updated;
  });
  await savePlans(next);
  return next.find((p) => p.id === target.id) ?? null;
}
async function resetPlans() {
  const defaults = clonePlans(PLANS);
  await savePlans(defaults);
  return defaults;
}

// server/util.ts
import crypto3 from "node:crypto";
function norm(s) {
  return s.toLowerCase().replace(/ё/g, "\u0435").replace(/[-–—_.,]/g, " ").replace(/\s+/g, " ").trim();
}
function hashStr(s) {
  let h4 = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h4 ^= s.charCodeAt(i);
    h4 = Math.imul(h4, 16777619);
  }
  return h4 >>> 0;
}
function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var rint = (r, min, max) => Math.floor(r() * (max - min + 1)) + min;
var pick = (r, arr) => arr[Math.floor(r() * arr.length)];
var randomToken = (bytes = 24) => crypto3.randomBytes(bytes).toString("base64url");
function cleanText(v, max) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto3.timingSafeEqual(ab, bb);
}

// server/bot.ts
var botUsername = config.botUsername;
async function getBotUsername() {
  if (botUsername || !config.botToken) return botUsername;
  const me = await tg("getMe");
  if (me.ok) botUsername = me.result.username;
  return botUsername;
}
async function tg(method, body = {}, timeoutMs = 1e4) {
  const r = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  return r.json();
}
async function notify(tgId, text, extra = {}) {
  if (!config.botToken) return;
  try {
    await tg("sendMessage", { chat_id: tgId, text, ...extra });
  } catch (e) {
    console.error("[bot] sendMessage", e);
  }
}
var publicUrl = () => /^https:\/\/(?!localhost\b|127\.0\.0\.1\b)/i.test(config.appUrl) ? config.appUrl : "https://fracs.cc.cd";
function docsMarkup(includeCabinet = true) {
  const base = publicUrl();
  const rows = [
    ...includeCabinet ? [[{ text: "\u{1F310} \u041B\u0438\u0447\u043D\u044B\u0439 \u043A\u0430\u0431\u0438\u043D\u0435\u0442", url: `${base}/app` }]] : [],
    [{ text: "\u{1F512} \u041F\u043E\u043B\u0438\u0442\u0438\u043A\u0430 \u043A\u043E\u043D\u0444\u0438\u0434\u0435\u043D\u0446\u0438\u0430\u043B\u044C\u043D\u043E\u0441\u0442\u0438", url: `${base}/privacy` }],
    [{ text: "\u{1F4C4} \u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C\u0441\u043A\u043E\u0435 \u0441\u043E\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u0435", url: `${base}/terms` }],
    [{ text: "\u{1F4D1} \u041F\u0443\u0431\u043B\u0438\u0447\u043D\u0430\u044F \u043E\u0444\u0435\u0440\u0442\u0430", url: `${base}/offer` }]
  ];
  return { inline_keyboard: rows };
}
var fmt = (iso) => iso ? new Date(iso).toLocaleDateString("ru-RU") : "\u2014";
var who = (u) => `${u.username ? "@" + u.username : u.firstName} (id ${u.tgId})`;
var ADMIN_HELP = `\u0410\u0434\u043C\u0438\u043D-\u043F\u0430\u043D\u0435\u043B\u044C Fracs

\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0438:
/grant <@username|id> [\u0434\u043D\u0435\u0439] \u2014 \u0432\u044B\u0434\u0430\u0442\u044C \u0438\u043B\u0438 \u043F\u0440\u043E\u0434\u043B\u0438\u0442\u044C \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0443 (\u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E 30)
/revoke <@username|id> \u2014 \u0441\u043D\u044F\u0442\u044C \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0443
/user <@username|id> \u2014 \u0441\u0442\u0430\u0442\u0443\u0441 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F
/users \u2014 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 10 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0435\u0439

\u0422\u0430\u0440\u0438\u0444\u044B \u0438 \u0446\u0435\u043D\u044B:
/plans \u2014 \u0441\u043F\u0438\u0441\u043E\u043A \u0442\u0435\u043A\u0443\u0449\u0438\u0445 \u0442\u0430\u0440\u0438\u0444\u043E\u0432
/setprice <id|1|2> <\u0446\u0435\u043D\u0430> \u2014 \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0446\u0435\u043D\u0443 (\u20BD)
/setdesc <id|1|2> <\u043E\u043F\u0438\u0441\u0430\u043D\u0438\u0435|-> \u2014 \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u043E\u043F\u0438\u0441\u0430\u043D\u0438\u0435 (- \u0447\u0442\u043E\u0431\u044B \u0443\u0431\u0440\u0430\u0442\u044C)
/settitle <id|1|2> <\u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435> \u2014 \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435
/setbadge <id|1|2> <\u0442\u0435\u043A\u0441\u0442|-> \u2014 \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0431\u0435\u0439\u0434\u0436 (- \u0447\u0442\u043E\u0431\u044B \u0443\u0431\u0440\u0430\u0442\u044C)
/setdays <id|1|2> <\u0434\u043D\u0435\u0439> \u2014 \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0434\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C
/resetplans \u2014 \u0441\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u0442\u0430\u0440\u0438\u0444\u044B \u043A \u0441\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u043D\u044B\u043C

\u041F\u0440\u0438\u043C\u0435\u0440\u044B:
/setprice month 1800
/setdesc quarter \u0412\u044B\u0433\u043E\u0434\u043D\u044B\u0439 \u0434\u043E\u0441\u0442\u0443\u043F \u043D\u0430 3 \u043C\u0435\u0441\u044F\u0446\u0430`;
var ADMIN_CMDS = [
  "/admin",
  "/grant",
  "/revoke",
  "/user",
  "/users",
  "/plans",
  "/setprice",
  "/setdesc",
  "/settitle",
  "/setbadge",
  "/setdays",
  "/resetplans"
];
function formatPlans(plans) {
  return plans.map(
    (p, i) => `${i + 1}. [${p.id}] ${p.title} \u2014 ${p.priceRub.toLocaleString("ru-RU")} \u20BD (${p.days} \u0434\u043D.)` + (p.badge ? `
   \u0411\u0435\u0439\u0434\u0436: ${p.badge}` : "") + `
   \u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435: ${p.description || "\u2014"}`
  ).join("\n\n");
}
async function handleAdmin(chatId, text) {
  const trimmed = text.trim();
  const [raw, ...args] = trimmed.split(/\s+/);
  const cmd = raw.split("@")[0].toLowerCase();
  if (!ADMIN_CMDS.includes(cmd)) return false;
  if (cmd === "/admin") {
    await notify(chatId, ADMIN_HELP);
    return true;
  }
  if (cmd === "/plans") {
    const plans = await getPlans();
    await notify(
      chatId,
      `\u0422\u0430\u0440\u0438\u0444\u044B:

${formatPlans(plans)}

\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0446\u0435\u043D\u0443: /setprice <id|\u043D\u043E\u043C\u0435\u0440> <\u0441\u0443\u043C\u043C\u0430>
\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u043E\u043F\u0438\u0441\u0430\u043D\u0438\u0435: /setdesc <id|\u043D\u043E\u043C\u0435\u0440> <\u0442\u0435\u043A\u0441\u0442>`
    );
    return true;
  }
  if (cmd === "/resetplans") {
    const plans = await resetPlans();
    await notify(chatId, `\u267B\uFE0F \u0422\u0430\u0440\u0438\u0444\u044B \u0441\u0431\u0440\u043E\u0448\u0435\u043D\u044B \u043A \u0441\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u043D\u044B\u043C:

${formatPlans(plans)}`);
    return true;
  }
  if (cmd === "/setprice") {
    const targetId = args[0];
    const price = Math.round(Number(args[1]));
    if (!targetId || !Number.isFinite(price) || price < 1 || price > 1e7) {
      await notify(chatId, "\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0438\u0435: /setprice <id|1|2> <\u0446\u0435\u043D\u0430 \u0432 \u20BD>\n\u041F\u0440\u0438\u043C\u0435\u0440: /setprice month 1800");
      return true;
    }
    const updated = await updatePlan(targetId, { priceRub: price });
    if (!updated) {
      await notify(chatId, "\u0422\u0430\u0440\u0438\u0444 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D. \u041F\u043E\u0441\u043C\u043E\u0442\u0440\u0438\u0442\u0435 \u0441\u043F\u0438\u0441\u043E\u043A \u043A\u043E\u043C\u0430\u043D\u0434\u043E\u0439 /plans");
      return true;
    }
    await notify(chatId, `\u2705 \u0426\u0435\u043D\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0430: [${updated.id}] ${updated.title} \u2014 ${updated.priceRub.toLocaleString("ru-RU")} \u20BD`);
    return true;
  }
  if (cmd === "/setdays") {
    const targetId = args[0];
    const days = Math.round(Number(args[1]));
    if (!targetId || !Number.isFinite(days) || days < 1 || days > 3650) {
      await notify(chatId, "\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0438\u0435: /setdays <id|1|2> <\u0434\u043D\u0435\u0439 \u043E\u0442 1 \u0434\u043E 3650>");
      return true;
    }
    const updated = await updatePlan(targetId, { days });
    if (!updated) {
      await notify(chatId, "\u0422\u0430\u0440\u0438\u0444 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D. \u041F\u043E\u0441\u043C\u043E\u0442\u0440\u0438\u0442\u0435 \u0441\u043F\u0438\u0441\u043E\u043A \u043A\u043E\u043C\u0430\u043D\u0434\u043E\u0439 /plans");
      return true;
    }
    await notify(chatId, `\u2705 \u0414\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0430: [${updated.id}] ${updated.title} \u2014 ${updated.days} \u0434\u043D.`);
    return true;
  }
  if (cmd === "/setdesc" || cmd === "/settitle" || cmd === "/setbadge") {
    const m = trimmed.match(/^\/\S+\s+(\S+)\s+([\s\S]+)$/);
    const targetId = m?.[1];
    const value = m?.[2]?.trim();
    if (!targetId || !value) {
      await notify(chatId, `\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0438\u0435: ${cmd} <id|1|2> <\u0442\u0435\u043A\u0441\u0442>${cmd === "/settitle" ? "" : " (\u0438\u043B\u0438 - \u0447\u0442\u043E\u0431\u044B \u043E\u0447\u0438\u0441\u0442\u0438\u0442\u044C)"}`);
      return true;
    }
    const cleanVal = value === "-" ? "" : value;
    const patch = cmd === "/setdesc" ? { description: cleanVal } : cmd === "/setbadge" ? { badge: cleanVal } : { title: value };
    const updated = await updatePlan(targetId, patch);
    if (!updated) {
      await notify(chatId, "\u0422\u0430\u0440\u0438\u0444 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D. \u041F\u043E\u0441\u043C\u043E\u0442\u0440\u0438\u0442\u0435 \u0441\u043F\u0438\u0441\u043E\u043A \u043A\u043E\u043C\u0430\u043D\u0434\u043E\u0439 /plans");
      return true;
    }
    await notify(
      chatId,
      `\u2705 \u0422\u0430\u0440\u0438\u0444 [${updated.id}] \u043E\u0431\u043D\u043E\u0432\u043B\u0451\u043D:
${updated.title} \u2014 ${updated.priceRub.toLocaleString("ru-RU")} \u20BD (${updated.days} \u0434\u043D.)` + (updated.badge ? `
\u0411\u0435\u0439\u0434\u0436: ${updated.badge}` : "") + `
\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435: ${updated.description || "\u2014"}`
    );
    return true;
  }
  if (cmd === "/users") {
    const list = await listRecentUsers(10);
    await notify(
      chatId,
      list.length ? list.map((u) => `${who(u)} \u2014 ${isSubscribed(u) ? "\u0434\u043E " + fmt(u.subscriptionUntil) : "\u043D\u0435\u0442 \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0438"}`).join("\n") : "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0435\u0439 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442."
    );
    return true;
  }
  const user = args[0] ? await findUser(args[0]) : null;
  if (!user) {
    await notify(chatId, args[0] ? "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D. \u041E\u043D \u0434\u043E\u043B\u0436\u0435\u043D \u0441\u043D\u0430\u0447\u0430\u043B\u0430 \u0432\u043E\u0439\u0442\u0438 \u0432 \u043A\u0430\u0431\u0438\u043D\u0435\u0442 \u0447\u0435\u0440\u0435\u0437 \u0431\u043E\u0442\u0430." : ADMIN_HELP);
    return true;
  }
  if (cmd === "/user") {
    await notify(chatId, `${who(user)}
\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430: ${isSubscribed(user) ? "\u0434\u043E " + fmt(user.subscriptionUntil) : "\u043D\u0435\u0442"}
\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044F: ${fmt(user.createdAt)}`);
  } else if (cmd === "/grant") {
    const days = Math.round(Number(args[1] ?? 30));
    if (!(days > 0 && days <= 3650)) {
      await notify(chatId, "\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u0447\u0438\u0441\u043B\u043E \u0434\u043D\u0435\u0439 \u043E\u0442 1 \u0434\u043E 3650.");
      return true;
    }
    const u = await extendSubscription(user.id, days);
    await notify(chatId, `\u2705 ${who(u)}: \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 \u0434\u043E ${fmt(u.subscriptionUntil)}`);
    await notify(u.tgId, `\u2705 \u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 Fracs \u0430\u043A\u0442\u0438\u0432\u043D\u0430 \u0434\u043E ${fmt(u.subscriptionUntil)}. \u041A\u0430\u0431\u0438\u043D\u0435\u0442: ${config.appUrl}/app`);
  } else if (cmd === "/revoke") {
    const u = await setSubscription(user.id, null);
    await notify(chatId, `\u{1F6AB} ${who(u)}: \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 \u0441\u043D\u044F\u0442\u0430`);
  }
  return true;
}
async function handleUpdate(update) {
  const msg = update?.message;
  if (!msg?.text || !msg.from || msg.chat?.type !== "private") return;
  if (config.adminTgId > 0 && msg.from.id === config.adminTgId) {
    try {
      if (await handleAdmin(msg.chat.id, msg.text)) return;
    } catch (e) {
      console.error("[bot] admin", e);
      await notify(msg.chat.id, `\u041E\u0448\u0438\u0431\u043A\u0430: ${e?.message || e}`);
      return;
    }
  }
  const [rawCmd, param] = msg.text.trim().split(/\s+/);
  const cmd = rawCmd.split("@")[0].toLowerCase();
  const base = publicUrl();
  if (cmd === "/privacy") {
    await notify(msg.chat.id, `\u{1F512} \u041F\u043E\u043B\u0438\u0442\u0438\u043A\u0430 \u043A\u043E\u043D\u0444\u0438\u0434\u0435\u043D\u0446\u0438\u0430\u043B\u044C\u043D\u043E\u0441\u0442\u0438 Fracs:
${base}/privacy`, {
      reply_markup: docsMarkup(false)
    });
    return;
  }
  if (cmd === "/terms") {
    await notify(msg.chat.id, `\u{1F4C4} \u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C\u0441\u043A\u043E\u0435 \u0441\u043E\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u0435 Fracs:
${base}/terms`, {
      reply_markup: docsMarkup(false)
    });
    return;
  }
  if (cmd === "/offer") {
    await notify(msg.chat.id, `\u{1F4D1} \u041F\u0443\u0431\u043B\u0438\u0447\u043D\u0430\u044F \u043E\u0444\u0435\u0440\u0442\u0430 Fracs:
${base}/offer`, {
      reply_markup: docsMarkup(false)
    });
    return;
  }
  if (cmd === "/docs") {
    await notify(msg.chat.id, "\u041F\u0440\u0430\u0432\u043E\u0432\u044B\u0435 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u044B \u0441\u0435\u0440\u0432\u0438\u0441\u0430 Fracs:", {
      reply_markup: docsMarkup(true)
    });
    return;
  }
  if (cmd !== "/start") {
    await notify(msg.chat.id, `\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043B\u0438\u0447\u043D\u044B\u0439 \u043A\u0430\u0431\u0438\u043D\u0435\u0442: ${base}/app`, {
      reply_markup: docsMarkup(true)
    });
    return;
  }
  if (!param) {
    await notify(
      msg.chat.id,
      `\u041F\u0440\u0438\u0432\u0435\u0442! \u042D\u0442\u043E \u0431\u043E\u0442 Fracs.

\u0427\u0442\u043E\u0431\u044B \u0432\u043E\u0439\u0442\u0438, \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u0412\u043E\u0439\u0442\u0438 \u0447\u0435\u0440\u0435\u0437 Telegram\xBB \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435 ${base}/app.

\u041F\u0435\u0440\u0435\u0434 \u043D\u0430\u0447\u0430\u043B\u043E\u043C \u0440\u0430\u0431\u043E\u0442\u044B \u0432\u044B \u043C\u043E\u0436\u0435\u0442\u0435 \u043E\u0437\u043D\u0430\u043A\u043E\u043C\u0438\u0442\u044C\u0441\u044F \u0441 \u043F\u0440\u0430\u0432\u043E\u0432\u044B\u043C\u0438 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430\u043C\u0438 \u043F\u043E \u043A\u043D\u043E\u043F\u043A\u0430\u043C \u043D\u0438\u0436\u0435:`,
      { reply_markup: docsMarkup(true) }
    );
    return;
  }
  const user = await upsertTgUser(msg.from);
  const ok = await bindLoginToken(param, user.id);
  if (!ok) {
    await notify(
      msg.chat.id,
      "\u0421\u0441\u044B\u043B\u043A\u0430 \u0443\u0441\u0442\u0430\u0440\u0435\u043B\u0430. \u0412\u0435\u0440\u043D\u0438\u0442\u0435\u0441\u044C \u043D\u0430 \u0441\u0430\u0439\u0442 \u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u0412\u043E\u0439\u0442\u0438 \u0447\u0435\u0440\u0435\u0437 Telegram\xBB \u0435\u0449\u0451 \u0440\u0430\u0437.",
      { reply_markup: docsMarkup(true) }
    );
    return;
  }
  await notify(
    msg.chat.id,
    `\u2705 \u0413\u043E\u0442\u043E\u0432\u043E, ${user.firstName}! \u0412\u0435\u0440\u043D\u0438\u0442\u0435\u0441\u044C \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440 \u2014 \u0432\u0445\u043E\u0434 \u0432\u044B\u043F\u043E\u043B\u043D\u0438\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438.

\u041F\u0440\u0430\u0432\u043E\u0432\u044B\u0435 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u044B \u0441\u0435\u0440\u0432\u0438\u0441\u0430 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B \u043F\u043E \u043A\u043D\u043E\u043F\u043A\u0430\u043C \u043D\u0438\u0436\u0435:`,
    { reply_markup: docsMarkup(false) }
  );
}
async function webhookHandler(req, res) {
  const got = req.get("x-telegram-bot-api-secret-token") || "";
  if (!config.webhookSecret || !safeEqual(got, config.webhookSecret)) {
    res.sendStatus(403);
    return;
  }
  try {
    await handleUpdate(req.body);
  } catch (e) {
    console.error("[bot] handleUpdate", e);
  }
  res.sendStatus(200);
}

// server/auth.ts
var COOKIE = "fracs_session";
var SESSION_MS = 30 * 864e5;
var sign = (p) => crypto4.createHmac("sha256", config.sessionSecret).update(p).digest("base64url");
function makeSession(uid) {
  const payload = Buffer.from(JSON.stringify({ u: uid, e: Date.now() + SESSION_MS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
function readSession(raw) {
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto4.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { u, e } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return e > Date.now() ? u : null;
  } catch {
    return null;
  }
}
function cookies(header = "") {
  return Object.fromEntries(
    header.split(";").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), decodeURIComponent(p.slice(i + 1).trim())];
    })
  );
}
function cookieOpts(req) {
  const secure = req.secure || req.get("x-forwarded-proto") === "https" || config.isProd;
  const sameSite = secure ? "None" : "Lax";
  return { secure, sameSite };
}
function setSession(req, res, uid) {
  const { secure, sameSite } = cookieOpts(req);
  res.append("Set-Cookie", `${COOKIE}=${makeSession(uid)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${SESSION_MS / 1e3}${secure ? "; Secure" : ""}`);
}
async function attachUser(req, _res, next) {
  try {
    const uid = readSession(cookies(req.headers.cookie)[COOKIE]);
    if (uid) req.user = await getUser(uid) ?? void 0;
    next();
  } catch (e) {
    next(e);
  }
}
function requireAuth(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized", message: "\u0412\u043E\u0439\u0434\u0438\u0442\u0435 \u0447\u0435\u0440\u0435\u0437 Telegram" });
    return;
  }
  next();
}
var h = (fn) => (req, res, next) => {
  fn(req, res).catch(next);
};
var authRouter = Router();
authRouter.post("/start", h(async (req, res) => {
  if (!await rateLimit(`auth:${req.ip}`, 20, 10 * 6e4)) return void res.status(429).json({ error: "rate_limited" });
  const username = await getBotUsername();
  if (!username) return void res.status(503).json({ error: "bot_not_configured", message: "\u0411\u043E\u0442 \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D" });
  const token = randomToken(24);
  await createLoginToken(token);
  res.json({ token, url: `https://t.me/${username}?start=${token}` });
}));
authRouter.get("/status", h(async (req, res) => {
  const token = String(req.query.token || "");
  const t = await getLoginToken(token);
  if (!t) return void res.json({ status: "expired" });
  if (!t.userId) return void res.json({ status: "pending" });
  const uid = await takeLoginToken(token);
  if (!uid) return void res.json({ status: "expired" });
  setSession(req, res, uid);
  res.json({ status: "ok" });
}));
authRouter.post("/dev", h(async (req, res) => {
  if (!config.devLogin) return void res.status(404).json({ error: "not_found" });
  let user = await upsertTgUser({ id: 1, username: "dev_user", first_name: "\u0420\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u0447\u0438\u043A" });
  if (!isSubscribed(user)) {
    user = await extendSubscription(user.id, 30);
  }
  setSession(req, res, user.id);
  res.json({ ok: true });
}));
authRouter.post("/logout", (req, res) => {
  const { secure, sameSite } = cookieOpts(req);
  res.append("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0${secure ? "; Secure" : ""}`);
  res.json({ ok: true });
});

// server/appRoutes.ts
import crypto5 from "node:crypto";
import { Router as Router2 } from "express";

// server/cityData.ts
var CITIES_BY_REGION = {
  "\u041C\u043E\u0441\u043A\u0432\u0430": ["\u041C\u043E\u0441\u043A\u0432\u0430"],
  "\u0421\u0430\u043D\u043A\u0442-\u041F\u0435\u0442\u0435\u0440\u0431\u0443\u0440\u0433": ["\u0421\u0430\u043D\u043A\u0442-\u041F\u0435\u0442\u0435\u0440\u0431\u0443\u0440\u0433"],
  "\u0421\u0435\u0432\u0430\u0441\u0442\u043E\u043F\u043E\u043B\u044C": ["\u0421\u0435\u0432\u0430\u0441\u0442\u043E\u043F\u043E\u043B\u044C"],
  "\u041C\u043E\u0441\u043A\u043E\u0432\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0411\u0430\u043B\u0430\u0448\u0438\u0445\u0430", "\u041F\u043E\u0434\u043E\u043B\u044C\u0441\u043A", "\u0425\u0438\u043C\u043A\u0438", "\u041A\u043E\u0440\u043E\u043B\u0451\u0432", "\u041C\u044B\u0442\u0438\u0449\u0438", "\u041B\u044E\u0431\u0435\u0440\u0446\u044B", "\u041A\u0440\u0430\u0441\u043D\u043E\u0433\u043E\u0440\u0441\u043A", "\u042D\u043B\u0435\u043A\u0442\u0440\u043E\u0441\u0442\u0430\u043B\u044C", "\u041A\u043E\u043B\u043E\u043C\u043D\u0430", "\u041E\u0434\u0438\u043D\u0446\u043E\u0432\u043E", "\u0414\u043E\u043C\u043E\u0434\u0435\u0434\u043E\u0432\u043E", "\u0421\u0435\u0440\u043F\u0443\u0445\u043E\u0432", "\u0429\u0451\u043B\u043A\u043E\u0432\u043E", "\u041E\u0440\u0435\u0445\u043E\u0432\u043E-\u0417\u0443\u0435\u0432\u043E", "\u0420\u0430\u043C\u0435\u043D\u0441\u043A\u043E\u0435", "\u0416\u0443\u043A\u043E\u0432\u0441\u043A\u0438\u0439", "\u041F\u0443\u0448\u043A\u0438\u043D\u043E", "\u0420\u0435\u0443\u0442\u043E\u0432", "\u0421\u0435\u0440\u0433\u0438\u0435\u0432 \u041F\u043E\u0441\u0430\u0434", "\u041D\u043E\u0433\u0438\u043D\u0441\u043A", "\u0414\u043E\u043B\u0433\u043E\u043F\u0440\u0443\u0434\u043D\u044B\u0439", "\u0412\u0438\u0434\u043D\u043E\u0435", "\u0412\u043E\u0441\u043A\u0440\u0435\u0441\u0435\u043D\u0441\u043A", "\u041A\u043B\u0438\u043D", "\u041B\u043E\u0431\u043D\u044F", "\u0414\u043C\u0438\u0442\u0440\u043E\u0432", "\u0415\u0433\u043E\u0440\u044C\u0435\u0432\u0441\u043A", "\u041D\u0430\u0440\u043E-\u0424\u043E\u043C\u0438\u043D\u0441\u043A", "\u0424\u0440\u044F\u0437\u0438\u043D\u043E", "\u0421\u0442\u0443\u043F\u0438\u043D\u043E", "\u0427\u0435\u0445\u043E\u0432", "\u0421\u043E\u043B\u043D\u0435\u0447\u043D\u043E\u0433\u043E\u0440\u0441\u043A", "\u0414\u0443\u0431\u043D\u0430", "\u041A\u0430\u0448\u0438\u0440\u0430", "\u0418\u0441\u0442\u0440\u0430", "\u0417\u0432\u0435\u043D\u0438\u0433\u043E\u0440\u043E\u0434", "\u0418\u0432\u0430\u043D\u0442\u0435\u0435\u0432\u043A\u0430", "\u0428\u0430\u0442\u0443\u0440\u0430", "\u041F\u0430\u0432\u043B\u043E\u0432\u0441\u043A\u0438\u0439 \u041F\u043E\u0441\u0430\u0434", "\u0420\u0443\u0437\u0430", "\u041B\u043E\u0441\u0438\u043D\u043E-\u041F\u0435\u0442\u0440\u043E\u0432\u0441\u043A\u0438\u0439", "\u0414\u0437\u0435\u0440\u0436\u0438\u043D\u0441\u043A\u0438\u0439", "\u041A\u043E\u0442\u0435\u043B\u044C\u043D\u0438\u043A\u0438", "\u041A\u0440\u0430\u0441\u043D\u043E\u0430\u0440\u043C\u0435\u0439\u0441\u043A", "\u042D\u043B\u0435\u043A\u0442\u0440\u043E\u0433\u043E\u0440\u0441\u043A", "\u041F\u0440\u043E\u0442\u0432\u0438\u043D\u043E", "\u041B\u0443\u0445\u043E\u0432\u0438\u0446\u044B", "\u0412\u0435\u0440\u0435\u044F", "\u041C\u043E\u0436\u0430\u0439\u0441\u043A", "\u0412\u043E\u043B\u043E\u043A\u043E\u043B\u0430\u043C\u0441\u043A", "\u041E\u0437\u0451\u0440\u044B", "\u0417\u0430\u0440\u0430\u0439\u0441\u043A", "\u0422\u0430\u043B\u0434\u043E\u043C", "\u042F\u0445\u0440\u043E\u043C\u0430"],
  "\u041B\u0435\u043D\u0438\u043D\u0433\u0440\u0430\u0434\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0413\u0430\u0442\u0447\u0438\u043D\u0430", "\u0412\u0441\u0435\u0432\u043E\u043B\u043E\u0436\u0441\u043A", "\u0412\u044B\u0431\u043E\u0440\u0433", "\u0422\u043E\u0441\u043D\u043E", "\u0421\u043E\u0441\u043D\u043E\u0432\u044B\u0439 \u0411\u043E\u0440", "\u041A\u0438\u0440\u0438\u0448\u0438", "\u0421\u0435\u0440\u0442\u043E\u043B\u043E\u0432\u043E", "\u041A\u0438\u043D\u0433\u0438\u0441\u0435\u043F\u043F", "\u0412\u043E\u043B\u0445\u043E\u0432", "\u0422\u0438\u0445\u0432\u0438\u043D", "\u041B\u0443\u0433\u0430", "\u041F\u043E\u0434\u043F\u043E\u0440\u043E\u0436\u044C\u0435", "\u041A\u0438\u0440\u043E\u0432\u0441\u043A", "\u041B\u043E\u0434\u0435\u0439\u043D\u043E\u0435 \u041F\u043E\u043B\u0435", "\u041F\u0440\u0438\u043E\u0437\u0435\u0440\u0441\u043A", "\u0421\u043B\u0430\u043D\u0446\u044B", "\u0418\u0432\u0430\u043D\u0433\u043E\u0440\u043E\u0434", "\u0428\u043B\u0438\u0441\u0441\u0435\u043B\u044C\u0431\u0443\u0440\u0433", "\u0411\u043E\u043A\u0441\u0438\u0442\u043E\u0433\u043E\u0440\u0441\u043A"],
  "\u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430 \u0410\u0434\u044B\u0433\u0435\u044F": ["\u041C\u0430\u0439\u043A\u043E\u043F", "\u0410\u0434\u044B\u0433\u0435\u0439\u0441\u043A"],
  "\u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430 \u0410\u043B\u0442\u0430\u0439": ["\u0413\u043E\u0440\u043D\u043E-\u0410\u043B\u0442\u0430\u0439\u0441\u043A"],
  "\u0410\u043B\u0442\u0430\u0439\u0441\u043A\u0438\u0439 \u043A\u0440\u0430\u0439": ["\u0411\u0430\u0440\u043D\u0430\u0443\u043B", "\u0411\u0438\u0439\u0441\u043A", "\u0420\u0443\u0431\u0446\u043E\u0432\u0441\u043A", "\u041D\u043E\u0432\u043E\u0430\u043B\u0442\u0430\u0439\u0441\u043A", "\u0417\u0430\u0440\u0438\u043D\u0441\u043A", "\u041A\u0430\u043C\u0435\u043D\u044C-\u043D\u0430-\u041E\u0431\u0438", "\u0421\u043B\u0430\u0432\u0433\u043E\u0440\u043E\u0434", "\u0411\u0435\u043B\u043E\u043A\u0443\u0440\u0438\u0445\u0430", "\u0410\u043B\u0435\u0439\u0441\u043A", "\u042F\u0440\u043E\u0432\u043E\u0435"],
  "\u0410\u043C\u0443\u0440\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0411\u043B\u0430\u0433\u043E\u0432\u0435\u0449\u0435\u043D\u0441\u043A", "\u0421\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0439", "\u0411\u0435\u043B\u043E\u0433\u043E\u0440\u0441\u043A", "\u0422\u044B\u043D\u0434\u0430", "\u0428\u0438\u043C\u0430\u043D\u043E\u0432\u0441\u043A", "\u0417\u0435\u044F"],
  "\u0410\u0440\u0445\u0430\u043D\u0433\u0435\u043B\u044C\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0410\u0440\u0445\u0430\u043D\u0433\u0435\u043B\u044C\u0441\u043A", "\u0421\u0435\u0432\u0435\u0440\u043E\u0434\u0432\u0438\u043D\u0441\u043A", "\u041A\u043E\u0442\u043B\u0430\u0441", "\u041D\u043E\u0432\u043E\u0434\u0432\u0438\u043D\u0441\u043A", "\u041C\u0438\u0440\u043D\u044B\u0439", "\u041A\u043E\u0440\u044F\u0436\u043C\u0430", "\u041D\u044F\u043D\u0434\u043E\u043C\u0430", "\u0412\u0435\u043B\u044C\u0441\u043A"],
  "\u0410\u0441\u0442\u0440\u0430\u0445\u0430\u043D\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0410\u0441\u0442\u0440\u0430\u0445\u0430\u043D\u044C", "\u0410\u0445\u0442\u0443\u0431\u0438\u043D\u0441\u043A", "\u0417\u043D\u0430\u043C\u0435\u043D\u0441\u043A", "\u0425\u0430\u0440\u0430\u0431\u0430\u043B\u0438"],
  "\u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430 \u0411\u0430\u0448\u043A\u043E\u0440\u0442\u043E\u0441\u0442\u0430\u043D": ["\u0423\u0444\u0430", "\u0421\u0442\u0435\u0440\u043B\u0438\u0442\u0430\u043C\u0430\u043A", "\u0421\u0430\u043B\u0430\u0432\u0430\u0442", "\u041D\u0435\u0444\u0442\u0435\u043A\u0430\u043C\u0441\u043A", "\u041E\u043A\u0442\u044F\u0431\u0440\u044C\u0441\u043A\u0438\u0439", "\u0411\u0435\u043B\u043E\u0440\u0435\u0446\u043A", "\u0422\u0443\u0439\u043C\u0430\u0437\u044B", "\u0418\u0448\u0438\u043C\u0431\u0430\u0439", "\u041C\u0435\u043B\u0435\u0443\u0437", "\u0421\u0438\u0431\u0430\u0439", "\u041A\u0443\u043C\u0435\u0440\u0442\u0430\u0443", "\u0411\u0435\u043B\u0435\u0431\u0435\u0439", "\u0411\u0438\u0440\u0441\u043A", "\u0414\u0430\u0432\u043B\u0435\u043A\u0430\u043D\u043E\u0432\u043E", "\u0423\u0447\u0430\u043B\u044B", "\u0411\u043B\u0430\u0433\u043E\u0432\u0435\u0449\u0435\u043D\u0441\u043A", "\u0411\u0430\u0439\u043C\u0430\u043A"],
  "\u0411\u0435\u043B\u0433\u043E\u0440\u043E\u0434\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0411\u0435\u043B\u0433\u043E\u0440\u043E\u0434", "\u0421\u0442\u0430\u0440\u044B\u0439 \u041E\u0441\u043A\u043E\u043B", "\u0413\u0443\u0431\u043A\u0438\u043D", "\u0428\u0435\u0431\u0435\u043A\u0438\u043D\u043E", "\u0412\u0430\u043B\u0443\u0439\u043A\u0438", "\u0410\u043B\u0435\u043A\u0441\u0435\u0435\u0432\u043A\u0430", "\u041D\u043E\u0432\u044B\u0439 \u041E\u0441\u043A\u043E\u043B", "\u0421\u0442\u0440\u043E\u0438\u0442\u0435\u043B\u044C"],
  "\u0411\u0440\u044F\u043D\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0411\u0440\u044F\u043D\u0441\u043A", "\u041A\u043B\u0438\u043D\u0446\u044B", "\u041D\u043E\u0432\u043E\u0437\u044B\u0431\u043A\u043E\u0432", "\u0414\u044F\u0442\u044C\u043A\u043E\u0432\u043E", "\u0421\u0435\u043B\u044C\u0446\u043E", "\u0423\u043D\u0435\u0447\u0430", "\u041F\u043E\u0447\u0435\u043F", "\u0424\u043E\u043A\u0438\u043D\u043E"],
  "\u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430 \u0411\u0443\u0440\u044F\u0442\u0438\u044F": ["\u0423\u043B\u0430\u043D-\u0423\u0434\u044D", "\u0421\u0435\u0432\u0435\u0440\u043E\u0431\u0430\u0439\u043A\u0430\u043B\u044C\u0441\u043A", "\u0413\u0443\u0441\u0438\u043D\u043E\u043E\u0437\u0451\u0440\u0441\u043A", "\u0417\u0430\u043A\u0430\u043C\u0435\u043D\u0441\u043A"],
  "\u0412\u043B\u0430\u0434\u0438\u043C\u0438\u0440\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0412\u043B\u0430\u0434\u0438\u043C\u0438\u0440", "\u041A\u043E\u0432\u0440\u043E\u0432", "\u041C\u0443\u0440\u043E\u043C", "\u0410\u043B\u0435\u043A\u0441\u0430\u043D\u0434\u0440\u043E\u0432", "\u0413\u0443\u0441\u044C-\u0425\u0440\u0443\u0441\u0442\u0430\u043B\u044C\u043D\u044B\u0439", "\u0421\u043E\u0431\u0438\u043D\u043A\u0430", "\u0412\u044F\u0437\u043D\u0438\u043A\u0438", "\u041A\u0438\u0440\u0436\u0430\u0447", "\u0421\u0442\u0440\u0443\u043D\u0438\u043D\u043E", "\u0421\u0443\u0434\u043E\u0433\u0434\u0430", "\u042E\u0440\u044C\u0435\u0432-\u041F\u043E\u043B\u044C\u0441\u043A\u043E\u0439", "\u041F\u0435\u0442\u0443\u0448\u043A\u0438", "\u041A\u0430\u043C\u0435\u0448\u043A\u043E\u0432\u043E"],
  "\u0412\u043E\u043B\u0433\u043E\u0433\u0440\u0430\u0434\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0412\u043E\u043B\u0433\u043E\u0433\u0440\u0430\u0434", "\u0412\u043E\u043B\u0436\u0441\u043A\u0438\u0439", "\u041A\u0430\u043C\u044B\u0448\u0438\u043D", "\u041C\u0438\u0445\u0430\u0439\u043B\u043E\u0432\u043A\u0430", "\u0423\u0440\u044E\u043F\u0438\u043D\u0441\u043A", "\u0424\u0440\u043E\u043B\u043E\u0432\u043E", "\u041A\u0430\u043B\u0430\u0447-\u043D\u0430-\u0414\u043E\u043D\u0443", "\u041A\u043E\u0442\u043E\u0432\u043E", "\u041D\u0438\u043A\u043E\u043B\u0430\u0435\u0432\u0441\u043A", "\u0416\u0438\u0440\u043D\u043E\u0432\u0441\u043A", "\u0421\u0443\u0440\u043E\u0432\u0438\u043A\u0438\u043D\u043E"],
  "\u0412\u043E\u043B\u043E\u0433\u043E\u0434\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0412\u043E\u043B\u043E\u0433\u0434\u0430", "\u0427\u0435\u0440\u0435\u043F\u043E\u0432\u0435\u0446", "\u0421\u043E\u043A\u043E\u043B", "\u0412\u0435\u043B\u0438\u043A\u0438\u0439 \u0423\u0441\u0442\u044E\u0433", "\u0413\u0440\u044F\u0437\u043E\u0432\u0435\u0446", "\u0411\u0435\u043B\u043E\u0437\u0435\u0440\u0441\u043A", "\u0422\u043E\u0442\u044C\u043C\u0430", "\u0423\u0441\u0442\u044E\u0436\u043D\u0430"],
  "\u0412\u043E\u0440\u043E\u043D\u0435\u0436\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0412\u043E\u0440\u043E\u043D\u0435\u0436", "\u0411\u043E\u0440\u0438\u0441\u043E\u0433\u043B\u0435\u0431\u0441\u043A", "\u0420\u043E\u0441\u0441\u043E\u0448\u044C", "\u041D\u043E\u0432\u043E\u0432\u043E\u0440\u043E\u043D\u0435\u0436", "\u041B\u0438\u0441\u043A\u0438", "\u041E\u0441\u0442\u0440\u043E\u0433\u043E\u0436\u0441\u043A", "\u0411\u0443\u0442\u0443\u0440\u043B\u0438\u043D\u043E\u0432\u043A\u0430", "\u041A\u0430\u043B\u0430\u0447", "\u0421\u0435\u043C\u0438\u043B\u0443\u043A\u0438", "\u041F\u0430\u0432\u043B\u043E\u0432\u0441\u043A", "\u0411\u043E\u0433\u0443\u0447\u0430\u0440", "\u042D\u0440\u0442\u0438\u043B\u044C"],
  "\u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430 \u0414\u0430\u0433\u0435\u0441\u0442\u0430\u043D": ["\u041C\u0430\u0445\u0430\u0447\u043A\u0430\u043B\u0430", "\u0425\u0430\u0441\u0430\u0432\u044E\u0440\u0442", "\u0414\u0435\u0440\u0431\u0435\u043D\u0442", "\u041A\u0430\u0441\u043F\u0438\u0439\u0441\u043A", "\u0411\u0443\u0439\u043D\u0430\u043A\u0441\u043A", "\u0418\u0437\u0431\u0435\u0440\u0431\u0430\u0448", "\u041A\u0438\u0437\u043B\u044F\u0440", "\u041A\u0438\u0437\u0438\u043B\u044E\u0440\u0442", "\u0414\u0430\u0433\u0435\u0441\u0442\u0430\u043D\u0441\u043A\u0438\u0435 \u041E\u0433\u043D\u0438", "\u042E\u0436\u043D\u043E-\u0421\u0443\u0445\u043E\u043A\u0443\u043C\u0441\u043A"],
  "\u0415\u0432\u0440\u0435\u0439\u0441\u043A\u0430\u044F \u0430\u0432\u0442\u043E\u043D\u043E\u043C\u043D\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0411\u0438\u0440\u043E\u0431\u0438\u0434\u0436\u0430\u043D", "\u041E\u0431\u043B\u0443\u0447\u044C\u0435"],
  "\u0417\u0430\u0431\u0430\u0439\u043A\u0430\u043B\u044C\u0441\u043A\u0438\u0439 \u043A\u0440\u0430\u0439": ["\u0427\u0438\u0442\u0430", "\u041A\u0440\u0430\u0441\u043D\u043E\u043A\u0430\u043C\u0435\u043D\u0441\u043A", "\u0411\u043E\u0440\u0437\u044F", "\u041F\u0435\u0442\u0440\u043E\u0432\u0441\u043A-\u0417\u0430\u0431\u0430\u0439\u043A\u0430\u043B\u044C\u0441\u043A\u0438\u0439", "\u0425\u0438\u043B\u043E\u043A", "\u041D\u0435\u0440\u0447\u0438\u043D\u0441\u043A"],
  "\u0418\u0432\u0430\u043D\u043E\u0432\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0418\u0432\u0430\u043D\u043E\u0432\u043E", "\u041A\u0438\u043D\u0435\u0448\u043C\u0430", "\u0428\u0443\u044F", "\u0412\u0438\u0447\u0443\u0433\u0430", "\u0422\u0435\u0439\u043A\u043E\u0432\u043E", "\u0424\u0443\u0440\u043C\u0430\u043D\u043E\u0432", "\u0420\u043E\u0434\u043D\u0438\u043A\u0438", "\u041F\u0440\u0438\u0432\u043E\u043B\u0436\u0441\u043A"],
  "\u0418\u0440\u043A\u0443\u0442\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0418\u0440\u043A\u0443\u0442\u0441\u043A", "\u0411\u0440\u0430\u0442\u0441\u043A", "\u0410\u043D\u0433\u0430\u0440\u0441\u043A", "\u0423\u0441\u0442\u044C-\u0418\u043B\u0438\u043C\u0441\u043A", "\u0423\u0441\u043E\u043B\u044C\u0435-\u0421\u0438\u0431\u0438\u0440\u0441\u043A\u043E\u0435", "\u0428\u0435\u043B\u0435\u0445\u043E\u0432", "\u0427\u0435\u0440\u0435\u043C\u0445\u043E\u0432\u043E", "\u0421\u0430\u044F\u043D\u0441\u043A", "\u0422\u0443\u043B\u0443\u043D", "\u041D\u0438\u0436\u043D\u0435\u0443\u0434\u0438\u043D\u0441\u043A", "\u0423\u0441\u0442\u044C-\u041A\u0443\u0442", "\u0417\u0438\u043C\u0430", "\u0416\u0435\u043B\u0435\u0437\u043D\u043E\u0433\u043E\u0440\u0441\u043A-\u0418\u043B\u0438\u043C\u0441\u043A\u0438\u0439", "\u0411\u043E\u0434\u0430\u0439\u0431\u043E"],
  "\u041A\u0430\u0431\u0430\u0440\u0434\u0438\u043D\u043E-\u0411\u0430\u043B\u043A\u0430\u0440\u0441\u043A\u0430\u044F \u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430": ["\u041D\u0430\u043B\u044C\u0447\u0438\u043A", "\u041F\u0440\u043E\u0445\u043B\u0430\u0434\u043D\u044B\u0439", "\u0411\u0430\u043A\u0441\u0430\u043D", "\u041D\u0430\u0440\u0442\u043A\u0430\u043B\u0430", "\u0422\u0435\u0440\u0435\u043A", "\u041C\u0430\u0439\u0441\u043A\u0438\u0439"],
  "\u041A\u0430\u043B\u0438\u043D\u0438\u043D\u0433\u0440\u0430\u0434\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u041A\u0430\u043B\u0438\u043D\u0438\u043D\u0433\u0440\u0430\u0434", "\u0421\u043E\u0432\u0435\u0442\u0441\u043A", "\u0427\u0435\u0440\u043D\u044F\u0445\u043E\u0432\u0441\u043A", "\u0411\u0430\u043B\u0442\u0438\u0439\u0441\u043A", "\u0413\u0443\u0441\u0435\u0432", "\u0421\u0432\u0435\u0442\u043B\u043E\u0433\u043E\u0440\u0441\u043A", "\u0417\u0435\u043B\u0435\u043D\u043E\u0433\u0440\u0430\u0434\u0441\u043A", "\u0413\u0432\u0430\u0440\u0434\u0435\u0439\u0441\u043A", "\u0421\u0432\u0435\u0442\u043B\u044B\u0439", "\u041D\u0435\u043C\u0430\u043D", "\u041F\u0440\u0430\u0432\u0434\u0438\u043D\u0441\u043A"],
  "\u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430 \u041A\u0430\u043B\u043C\u044B\u043A\u0438\u044F": ["\u042D\u043B\u0438\u0441\u0442\u0430", "\u0413\u043E\u0440\u043E\u0434\u043E\u0432\u0438\u043A\u043E\u0432\u0441\u043A", "\u041B\u0430\u0433\u0430\u043D\u044C"],
  "\u041A\u0430\u043B\u0443\u0436\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u041A\u0430\u043B\u0443\u0433\u0430", "\u041E\u0431\u043D\u0438\u043D\u0441\u043A", "\u041B\u044E\u0434\u0438\u043D\u043E\u0432\u043E", "\u041A\u0438\u0440\u043E\u0432", "\u041C\u0430\u043B\u043E\u044F\u0440\u043E\u0441\u043B\u0430\u0432\u0435\u0446", "\u0411\u043E\u0440\u043E\u0432\u0441\u043A", "\u0411\u0430\u043B\u0430\u0431\u0430\u043D\u043E\u0432\u043E", "\u041A\u043E\u0437\u0435\u043B\u044C\u0441\u043A", "\u0416\u0443\u043A\u043E\u0432", "\u0421\u0443\u0445\u0438\u043D\u0438\u0447\u0438", "\u041C\u0435\u0449\u043E\u0432\u0441\u043A"],
  "\u041A\u0430\u043C\u0447\u0430\u0442\u0441\u043A\u0438\u0439 \u043A\u0440\u0430\u0439": ["\u041F\u0435\u0442\u0440\u043E\u043F\u0430\u0432\u043B\u043E\u0432\u0441\u043A-\u041A\u0430\u043C\u0447\u0430\u0442\u0441\u043A\u0438\u0439", "\u0415\u043B\u0438\u0437\u043E\u0432\u043E", "\u0412\u0438\u043B\u044E\u0447\u0438\u043D\u0441\u043A"],
  "\u041A\u0430\u0440\u0430\u0447\u0430\u0435\u0432\u043E-\u0427\u0435\u0440\u043A\u0435\u0441\u0441\u043A\u0430\u044F \u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430": ["\u0427\u0435\u0440\u043A\u0435\u0441\u0441\u043A", "\u041A\u0430\u0440\u0430\u0447\u0430\u0435\u0432\u0441\u043A", "\u0423\u0441\u0442\u044C-\u0414\u0436\u0435\u0433\u0443\u0442\u0430", "\u0422\u0435\u0431\u0435\u0440\u0434\u0430"],
  "\u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430 \u041A\u0430\u0440\u0435\u043B\u0438\u044F": ["\u041F\u0435\u0442\u0440\u043E\u0437\u0430\u0432\u043E\u0434\u0441\u043A", "\u041A\u043E\u0441\u0442\u043E\u043C\u0443\u043A\u0448\u0430", "\u041A\u043E\u043D\u0434\u043E\u043F\u043E\u0433\u0430", "\u0421\u0435\u0433\u0435\u0436\u0430", "\u0421\u043E\u0440\u0442\u0430\u0432\u0430\u043B\u0430", "\u041A\u0435\u043C\u044C", "\u041C\u0435\u0434\u0432\u0435\u0436\u044C\u0435\u0433\u043E\u0440\u0441\u043A", "\u041F\u0438\u0442\u043A\u044F\u0440\u0430\u043D\u0442\u0430", "\u0411\u0435\u043B\u043E\u043C\u043E\u0440\u0441\u043A", "\u041E\u043B\u043E\u043D\u0435\u0446"],
  "\u041A\u0435\u043C\u0435\u0440\u043E\u0432\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u041A\u0435\u043C\u0435\u0440\u043E\u0432\u043E", "\u041D\u043E\u0432\u043E\u043A\u0443\u0437\u043D\u0435\u0446\u043A", "\u041F\u0440\u043E\u043A\u043E\u043F\u044C\u0435\u0432\u0441\u043A", "\u041B\u0435\u043D\u0438\u043D\u0441\u043A-\u041A\u0443\u0437\u043D\u0435\u0446\u043A\u0438\u0439", "\u041C\u0435\u0436\u0434\u0443\u0440\u0435\u0447\u0435\u043D\u0441\u043A", "\u041A\u0438\u0441\u0435\u043B\u0451\u0432\u0441\u043A", "\u041C\u044B\u0441\u043A\u0438", "\u0411\u0435\u043B\u043E\u0432\u043E", "\u0410\u043D\u0436\u0435\u0440\u043E-\u0421\u0443\u0434\u0436\u0435\u043D\u0441\u043A", "\u042E\u0440\u0433\u0430", "\u0411\u0435\u0440\u0435\u0437\u043E\u0432\u0441\u043A\u0438\u0439", "\u041E\u0441\u0438\u043D\u043D\u0438\u043A\u0438", "\u0422\u0430\u0448\u0442\u0430\u0433\u043E\u043B", "\u041A\u0430\u043B\u0442\u0430\u043D", "\u041F\u043E\u043B\u044B\u0441\u0430\u0435\u0432\u043E", "\u0413\u0443\u0440\u044C\u0435\u0432\u0441\u043A", "\u0422\u043E\u043F\u043A\u0438", "\u041C\u0430\u0440\u0438\u0438\u043D\u0441\u043A"],
  "\u041A\u0438\u0440\u043E\u0432\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u041A\u0438\u0440\u043E\u0432", "\u041A\u0438\u0440\u043E\u0432\u043E-\u0427\u0435\u043F\u0435\u0446\u043A", "\u0421\u043B\u043E\u0431\u043E\u0434\u0441\u043A\u043E\u0439", "\u0412\u044F\u0442\u0441\u043A\u0438\u0435 \u041F\u043E\u043B\u044F\u043D\u044B", "\u041A\u043E\u0442\u0435\u043B\u044C\u043D\u0438\u0447", "\u041E\u043C\u0443\u0442\u043D\u0438\u043D\u0441\u043A", "\u042F\u0440\u0430\u043D\u0441\u043A", "\u041C\u0430\u043B\u043C\u044B\u0436", "\u041D\u043E\u043B\u0438\u043D\u0441\u043A"],
  "\u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430 \u041A\u043E\u043C\u0438": ["\u0421\u044B\u043A\u0442\u044B\u0432\u043A\u0430\u0440", "\u0423\u0445\u0442\u0430", "\u0412\u043E\u0440\u043A\u0443\u0442\u0430", "\u041F\u0435\u0447\u043E\u0440\u0430", "\u0423\u0441\u0438\u043D\u0441\u043A", "\u0418\u043D\u0442\u0430", "\u0421\u043E\u0441\u043D\u043E\u0433\u043E\u0440\u0441\u043A", "\u0412\u0443\u043A\u0442\u044B\u043B", "\u0415\u043C\u0432\u0430"],
  "\u041A\u043E\u0441\u0442\u0440\u043E\u043C\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u041A\u043E\u0441\u0442\u0440\u043E\u043C\u0430", "\u0411\u0443\u0439", "\u0428\u0430\u0440\u044C\u044F", "\u041D\u0435\u0440\u0435\u0445\u0442\u0430", "\u0413\u0430\u043B\u0438\u0447", "\u041C\u0430\u043D\u0442\u0443\u0440\u043E\u0432\u043E", "\u0412\u043E\u043B\u0433\u043E\u0440\u0435\u0447\u0435\u043D\u0441\u043A"],
  "\u041A\u0440\u0430\u0441\u043D\u043E\u0434\u0430\u0440\u0441\u043A\u0438\u0439 \u043A\u0440\u0430\u0439": ["\u041A\u0440\u0430\u0441\u043D\u043E\u0434\u0430\u0440", "\u0421\u043E\u0447\u0438", "\u041D\u043E\u0432\u043E\u0440\u043E\u0441\u0441\u0438\u0439\u0441\u043A", "\u0410\u0440\u043C\u0430\u0432\u0438\u0440", "\u0415\u0439\u0441\u043A", "\u041A\u0440\u043E\u043F\u043E\u0442\u043A\u0438\u043D", "\u0422\u0443\u0430\u043F\u0441\u0435", "\u0410\u043D\u0430\u043F\u0430", "\u0413\u0435\u043B\u0435\u043D\u0434\u0436\u0438\u043A", "\u0421\u043B\u0430\u0432\u044F\u043D\u0441\u043A-\u043D\u0430-\u041A\u0443\u0431\u0430\u043D\u0438", "\u0411\u0435\u043B\u043E\u0440\u0435\u0447\u0435\u043D\u0441\u043A", "\u0422\u0438\u043C\u0430\u0448\u0451\u0432\u0441\u043A", "\u0422\u0438\u0445\u043E\u0440\u0435\u0446\u043A", "\u041A\u0443\u0440\u0433\u0430\u043D\u0438\u043D\u0441\u043A", "\u041B\u0430\u0431\u0438\u043D\u0441\u043A", "\u0423\u0441\u0442\u044C-\u041B\u0430\u0431\u0438\u043D\u0441\u043A", "\u0422\u0435\u043C\u0440\u044E\u043A", "\u0413\u043E\u0440\u044F\u0447\u0438\u0439 \u041A\u043B\u044E\u0447", "\u041A\u0440\u044B\u043C\u0441\u043A", "\u0410\u043F\u0448\u0435\u0440\u043E\u043D\u0441\u043A", "\u041F\u0440\u0438\u043C\u043E\u0440\u0441\u043A\u043E-\u0410\u0445\u0442\u0430\u0440\u0441\u043A", "\u0410\u0431\u0438\u043D\u0441\u043A", "\u041A\u043E\u0440\u0435\u043D\u043E\u0432\u0441\u043A", "\u0413\u0443\u043B\u044C\u043A\u0435\u0432\u0438\u0447\u0438", "\u041A\u0440\u044B\u043B\u043E\u0432\u0441\u043A\u0430\u044F", "\u041D\u043E\u0432\u043E\u043A\u0443\u0431\u0430\u043D\u0441\u043A", "\u0411\u0440\u044E\u0445\u043E\u0432\u0435\u0446\u043A\u0430\u044F"],
  "\u041A\u0440\u0430\u0441\u043D\u043E\u044F\u0440\u0441\u043A\u0438\u0439 \u043A\u0440\u0430\u0439": ["\u041A\u0440\u0430\u0441\u043D\u043E\u044F\u0440\u0441\u043A", "\u041D\u043E\u0440\u0438\u043B\u044C\u0441\u043A", "\u0410\u0447\u0438\u043D\u0441\u043A", "\u041A\u0430\u043D\u0441\u043A", "\u041C\u0438\u043D\u0443\u0441\u0438\u043D\u0441\u043A", "\u0416\u0435\u043B\u0435\u0437\u043D\u043E\u0433\u043E\u0440\u0441\u043A", "\u041B\u0435\u0441\u043E\u0441\u0438\u0431\u0438\u0440\u0441\u043A", "\u041D\u0430\u0437\u0430\u0440\u043E\u0432\u043E", "\u0421\u043E\u0441\u043D\u043E\u0432\u043E\u0431\u043E\u0440\u0441\u043A", "\u0417\u0435\u043B\u0435\u043D\u043E\u0433\u043E\u0440\u0441\u043A", "\u0414\u0438\u0432\u043D\u043E\u0433\u043E\u0440\u0441\u043A", "\u0428\u0430\u0440\u044B\u043F\u043E\u0432\u043E", "\u0411\u043E\u0433\u043E\u0442\u043E\u043B", "\u0423\u044F\u0440", "\u0411\u043E\u0440\u043E\u0434\u0438\u043D\u043E", "\u0415\u043D\u0438\u0441\u0435\u0439\u0441\u043A", "\u0418\u0433\u0430\u0440\u043A\u0430"],
  "\u041A\u0443\u0440\u0433\u0430\u043D\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u041A\u0443\u0440\u0433\u0430\u043D", "\u0428\u0430\u0434\u0440\u0438\u043D\u0441\u043A", "\u0428\u0443\u043C\u0438\u0445\u0430", "\u041A\u0430\u0442\u0430\u0439\u0441\u043A", "\u0414\u0430\u043B\u043C\u0430\u0442\u043E\u0432\u043E", "\u041A\u0443\u0440\u0442\u0430\u043C\u044B\u0448"],
  "\u041A\u0443\u0440\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u041A\u0443\u0440\u0441\u043A", "\u0416\u0435\u043B\u0435\u0437\u043D\u043E\u0433\u043E\u0440\u0441\u043A", "\u041A\u0443\u0440\u0447\u0430\u0442\u043E\u0432", "\u041B\u044C\u0433\u043E\u0432", "\u0429\u0438\u0433\u0440\u044B", "\u0414\u043C\u0438\u0442\u0440\u0438\u0435\u0432", "\u041E\u0431\u043E\u044F\u043D\u044C", "\u0420\u044B\u043B\u044C\u0441\u043A", "\u0421\u0443\u0434\u0436\u0430"],
  "\u041B\u0438\u043F\u0435\u0446\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u041B\u0438\u043F\u0435\u0446\u043A", "\u0415\u043B\u0435\u0446", "\u0413\u0440\u044F\u0437\u0438", "\u0414\u0430\u043D\u043A\u043E\u0432", "\u041B\u0435\u0431\u0435\u0434\u044F\u043D\u044C", "\u0417\u0430\u0434\u043E\u043D\u0441\u043A", "\u0423\u0441\u043C\u0430\u043D\u044C", "\u0427\u0430\u043F\u043B\u044B\u0433\u0438\u043D"],
  "\u041C\u0430\u0433\u0430\u0434\u0430\u043D\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u041C\u0430\u0433\u0430\u0434\u0430\u043D", "\u0421\u0443\u0441\u0443\u043C\u0430\u043D"],
  "\u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430 \u041C\u0430\u0440\u0438\u0439 \u042D\u043B": ["\u0419\u043E\u0448\u043A\u0430\u0440-\u041E\u043B\u0430", "\u0412\u043E\u043B\u0436\u0441\u043A", "\u041A\u043E\u0437\u044C\u043C\u043E\u0434\u0435\u043C\u044C\u044F\u043D\u0441\u043A"],
  "\u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430 \u041C\u043E\u0440\u0434\u043E\u0432\u0438\u044F": ["\u0421\u0430\u0440\u0430\u043D\u0441\u043A", "\u0420\u0443\u0437\u0430\u0435\u0432\u043A\u0430", "\u041A\u043E\u0432\u044B\u043B\u043A\u0438\u043D\u043E", "\u0410\u0440\u0434\u0430\u0442\u043E\u0432"],
  "\u041C\u0443\u0440\u043C\u0430\u043D\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u041C\u0443\u0440\u043C\u0430\u043D\u0441\u043A", "\u0410\u043F\u0430\u0442\u0438\u0442\u044B", "\u0421\u0435\u0432\u0435\u0440\u043E\u043C\u043E\u0440\u0441\u043A", "\u041C\u043E\u043D\u0447\u0435\u0433\u043E\u0440\u0441\u043A", "\u041A\u0430\u043D\u0434\u0430\u043B\u0430\u043A\u0448\u0430", "\u041E\u043B\u0435\u043D\u0435\u0433\u043E\u0440\u0441\u043A", "\u041F\u043E\u043B\u044F\u0440\u043D\u044B\u0435 \u0417\u043E\u0440\u0438", "\u041A\u043E\u043B\u0430", "\u0417\u0430\u043F\u043E\u043B\u044F\u0440\u043D\u044B\u0439", "\u041A\u0438\u0440\u043E\u0432\u0441\u043A"],
  "\u041D\u0435\u043D\u0435\u0446\u043A\u0438\u0439 \u0430\u0432\u0442\u043E\u043D\u043E\u043C\u043D\u044B\u0439 \u043E\u043A\u0440\u0443\u0433": ["\u041D\u0430\u0440\u044C\u044F\u043D-\u041C\u0430\u0440"],
  "\u041D\u0438\u0436\u0435\u0433\u043E\u0440\u043E\u0434\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u041D\u0438\u0436\u043D\u0438\u0439 \u041D\u043E\u0432\u0433\u043E\u0440\u043E\u0434", "\u0414\u0437\u0435\u0440\u0436\u0438\u043D\u0441\u043A", "\u0410\u0440\u0437\u0430\u043C\u0430\u0441", "\u0421\u0430\u0440\u043E\u0432", "\u041A\u0441\u0442\u043E\u0432\u043E", "\u041F\u0430\u0432\u043B\u043E\u0432\u043E", "\u0412\u044B\u043A\u0441\u0430", "\u0411\u0430\u043B\u0430\u0445\u043D\u0430", "\u0411\u043E\u0440", "\u0417\u0430\u0432\u043E\u043B\u0436\u044C\u0435", "\u0413\u043E\u0440\u043E\u0434\u0435\u0446", "\u0421\u0435\u043C\u0451\u043D\u043E\u0432", "\u0411\u043E\u0433\u043E\u0440\u043E\u0434\u0441\u043A", "\u041A\u0443\u043B\u0435\u0431\u0430\u043A\u0438", "\u041B\u044B\u0441\u043A\u043E\u0432\u043E", "\u0412\u043E\u043B\u043E\u0434\u0430\u0440\u0441\u043A", "\u0427\u043A\u0430\u043B\u043E\u0432\u0441\u043A", "\u041A\u043D\u044F\u0433\u0438\u043D\u0438\u043D\u043E"],
  "\u041D\u043E\u0432\u0433\u043E\u0440\u043E\u0434\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0412\u0435\u043B\u0438\u043A\u0438\u0439 \u041D\u043E\u0432\u0433\u043E\u0440\u043E\u0434", "\u0421\u0442\u0430\u0440\u0430\u044F \u0420\u0443\u0441\u0441\u0430", "\u0411\u043E\u0440\u043E\u0432\u0438\u0447\u0438", "\u0412\u0430\u043B\u0434\u0430\u0439", "\u041F\u0435\u0441\u0442\u043E\u0432\u043E", "\u0427\u0443\u0434\u043E\u0432\u043E"],
  "\u041D\u043E\u0432\u043E\u0441\u0438\u0431\u0438\u0440\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u041D\u043E\u0432\u043E\u0441\u0438\u0431\u0438\u0440\u0441\u043A", "\u0411\u0435\u0440\u0434\u0441\u043A", "\u0418\u0441\u043A\u0438\u0442\u0438\u043C", "\u041E\u0431\u044C", "\u041A\u0443\u0439\u0431\u044B\u0448\u0435\u0432", "\u0411\u0430\u0440\u0430\u0431\u0438\u043D\u0441\u043A", "\u0422\u0430\u0442\u0430\u0440\u0441\u043A", "\u041A\u0430\u0440\u0433\u0430\u0442", "\u0422\u043E\u0433\u0443\u0447\u0438\u043D", "\u041A\u0430\u0440\u0430\u0441\u0443\u043A", "\u041A\u043E\u043B\u044C\u0446\u043E\u0432\u043E"],
  "\u041E\u043C\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u041E\u043C\u0441\u043A", "\u0422\u0430\u0440\u0430", "\u0418\u0441\u0438\u043B\u044C\u043A\u0443\u043B\u044C", "\u041A\u0430\u043B\u0430\u0447\u0438\u043D\u0441\u043A", "\u041D\u0430\u0437\u044B\u0432\u0430\u0435\u0432\u0441\u043A"],
  "\u041E\u0440\u0435\u043D\u0431\u0443\u0440\u0433\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u041E\u0440\u0435\u043D\u0431\u0443\u0440\u0433", "\u041E\u0440\u0441\u043A", "\u041D\u043E\u0432\u043E\u0442\u0440\u043E\u0438\u0446\u043A", "\u0411\u0443\u0437\u0443\u043B\u0443\u043A", "\u0411\u0443\u0433\u0443\u0440\u0443\u0441\u043B\u0430\u043D", "\u041C\u0435\u0434\u043D\u043E\u0433\u043E\u0440\u0441\u043A", "\u0421\u043E\u0440\u043E\u0447\u0438\u043D\u0441\u043A", "\u0413\u0430\u0439", "\u0410\u0431\u0434\u0443\u043B\u0438\u043D\u043E", "\u041A\u0443\u0432\u0430\u043D\u0434\u044B\u043A", "\u042F\u0441\u043D\u044B\u0439"],
  "\u041E\u0440\u043B\u043E\u0432\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u041E\u0440\u0451\u043B", "\u041B\u0438\u0432\u043D\u044B", "\u041C\u0446\u0435\u043D\u0441\u043A"],
  "\u041F\u0435\u043D\u0437\u0435\u043D\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u041F\u0435\u043D\u0437\u0430", "\u041A\u0443\u0437\u043D\u0435\u0446\u043A", "\u0417\u0430\u0440\u0435\u0447\u043D\u044B\u0439", "\u0421\u0435\u0440\u0434\u043E\u0431\u0441\u043A", "\u041A\u0430\u043C\u0435\u043D\u043A\u0430", "\u041D\u0438\u0436\u043D\u0438\u0439 \u041B\u043E\u043C\u043E\u0432", "\u0411\u0435\u043B\u0438\u043D\u0441\u043A\u0438\u0439"],
  "\u041F\u0435\u0440\u043C\u0441\u043A\u0438\u0439 \u043A\u0440\u0430\u0439": ["\u041F\u0435\u0440\u043C\u044C", "\u0411\u0435\u0440\u0435\u0437\u043D\u0438\u043A\u0438", "\u0421\u043E\u043B\u0438\u043A\u0430\u043C\u0441\u043A", "\u0427\u0430\u0439\u043A\u043E\u0432\u0441\u043A\u0438\u0439", "\u041A\u0443\u043D\u0433\u0443\u0440", "\u041B\u044B\u0441\u044C\u0432\u0430", "\u0427\u0443\u0441\u043E\u0432\u043E\u0439", "\u041A\u0440\u0430\u0441\u043D\u043E\u043A\u0430\u043C\u0441\u043A", "\u0413\u0443\u0431\u0430\u0445\u0430", "\u0427\u0435\u0440\u043D\u0443\u0448\u043A\u0430", "\u0414\u043E\u0431\u0440\u044F\u043D\u043A\u0430", "\u041E\u0441\u0430", "\u0412\u0435\u0440\u0435\u0449\u0430\u0433\u0438\u043D\u043E", "\u041A\u0438\u0437\u0435\u043B", "\u0410\u043B\u0435\u043A\u0441\u0430\u043D\u0434\u0440\u043E\u0432\u0441\u043A", "\u041D\u044B\u0442\u0432\u0430"],
  "\u041F\u0440\u0438\u043C\u043E\u0440\u0441\u043A\u0438\u0439 \u043A\u0440\u0430\u0439": ["\u0412\u043B\u0430\u0434\u0438\u0432\u043E\u0441\u0442\u043E\u043A", "\u0423\u0441\u0441\u0443\u0440\u0438\u0439\u0441\u043A", "\u041D\u0430\u0445\u043E\u0434\u043A\u0430", "\u0410\u0440\u0442\u0451\u043C", "\u0411\u043E\u043B\u044C\u0448\u043E\u0439 \u041A\u0430\u043C\u0435\u043D\u044C", "\u0421\u043F\u0430\u0441\u0441\u043A-\u0414\u0430\u043B\u044C\u043D\u0438\u0439", "\u0410\u0440\u0441\u0435\u043D\u044C\u0435\u0432", "\u041F\u0430\u0440\u0442\u0438\u0437\u0430\u043D\u0441\u043A", "\u041B\u0435\u0441\u043E\u0437\u0430\u0432\u043E\u0434\u0441\u043A", "\u0414\u0430\u043B\u044C\u043D\u0435\u0433\u043E\u0440\u0441\u043A", "\u0414\u0430\u043B\u044C\u043D\u0435\u0440\u0435\u0447\u0435\u043D\u0441\u043A", "\u0424\u043E\u043A\u0438\u043D\u043E"],
  "\u041F\u0441\u043A\u043E\u0432\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u041F\u0441\u043A\u043E\u0432", "\u0412\u0435\u043B\u0438\u043A\u0438\u0435 \u041B\u0443\u043A\u0438", "\u041E\u0441\u0442\u0440\u043E\u0432", "\u041F\u0435\u0447\u043E\u0440\u044B", "\u041D\u0435\u0432\u0435\u043B\u044C", "\u041E\u043F\u043E\u0447\u043A\u0430"],
  "\u0420\u043E\u0441\u0442\u043E\u0432\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0420\u043E\u0441\u0442\u043E\u0432-\u043D\u0430-\u0414\u043E\u043D\u0443", "\u0422\u0430\u0433\u0430\u043D\u0440\u043E\u0433", "\u0428\u0430\u0445\u0442\u044B", "\u041D\u043E\u0432\u043E\u0447\u0435\u0440\u043A\u0430\u0441\u0441\u043A", "\u0412\u043E\u043B\u0433\u043E\u0434\u043E\u043D\u0441\u043A", "\u0411\u0430\u0442\u0430\u0439\u0441\u043A", "\u041D\u043E\u0432\u043E\u0448\u0430\u0445\u0442\u0438\u043D\u0441\u043A", "\u041A\u0430\u043C\u0435\u043D\u0441\u043A-\u0428\u0430\u0445\u0442\u0438\u043D\u0441\u043A\u0438\u0439", "\u0410\u0437\u043E\u0432", "\u0411\u0435\u043B\u0430\u044F \u041A\u0430\u043B\u0438\u0442\u0432\u0430", "\u0413\u0443\u043A\u043E\u0432\u043E", "\u0421\u0430\u043B\u044C\u0441\u043A", "\u0410\u043A\u0441\u0430\u0439", "\u041C\u0438\u043B\u043B\u0435\u0440\u043E\u0432\u043E", "\u0417\u0435\u0440\u043D\u043E\u0433\u0440\u0430\u0434", "\u041A\u0440\u0430\u0441\u043D\u044B\u0439 \u0421\u0443\u043B\u0438\u043D", "\u0426\u0438\u043C\u043B\u044F\u043D\u0441\u043A", "\u041C\u043E\u0440\u043E\u0437\u043E\u0432\u0441\u043A", "\u0421\u0435\u043C\u0438\u043A\u0430\u0440\u0430\u043A\u043E\u0440\u0441\u043A", "\u041A\u043E\u043D\u0441\u0442\u0430\u043D\u0442\u0438\u043D\u043E\u0432\u0441\u043A", "\u041F\u0440\u043E\u043B\u0435\u0442\u0430\u0440\u0441\u043A", "\u0417\u0432\u0435\u0440\u0435\u0432\u043E"],
  "\u0420\u044F\u0437\u0430\u043D\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0420\u044F\u0437\u0430\u043D\u044C", "\u041A\u0430\u0441\u0438\u043C\u043E\u0432", "\u0421\u043A\u043E\u043F\u0438\u043D", "\u0421\u0430\u0441\u043E\u0432\u043E", "\u041C\u0438\u0445\u0430\u0439\u043B\u043E\u0432", "\u0428\u0430\u0446\u043A", "\u0420\u044F\u0436\u0441\u043A", "\u0421\u043F\u0430\u0441-\u041A\u043B\u0435\u043F\u0438\u043A\u0438", "\u041A\u043E\u0440\u0430\u0431\u043B\u0438\u043D\u043E"],
  "\u0421\u0430\u043C\u0430\u0440\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0421\u0430\u043C\u0430\u0440\u0430", "\u0422\u043E\u043B\u044C\u044F\u0442\u0442\u0438", "\u0421\u044B\u0437\u0440\u0430\u043D\u044C", "\u041D\u043E\u0432\u043E\u043A\u0443\u0439\u0431\u044B\u0448\u0435\u0432\u0441\u043A", "\u0427\u0430\u043F\u0430\u0435\u0432\u0441\u043A", "\u041E\u0442\u0440\u0430\u0434\u043D\u044B\u0439", "\u0416\u0438\u0433\u0443\u043B\u0451\u0432\u0441\u043A", "\u041F\u043E\u0445\u0432\u0438\u0441\u0442\u043D\u0435\u0432\u043E", "\u041A\u0438\u043D\u0435\u043B\u044C", "\u041E\u043A\u0442\u044F\u0431\u0440\u044C\u0441\u043A", "\u041D\u0435\u0444\u0442\u0435\u0433\u043E\u0440\u0441\u043A", "\u0411\u0435\u0437\u0435\u043D\u0447\u0443\u043A", "\u0411\u043E\u0433\u0430\u0442\u043E\u0435"],
  "\u0421\u0430\u0440\u0430\u0442\u043E\u0432\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0421\u0430\u0440\u0430\u0442\u043E\u0432", "\u042D\u043D\u0433\u0435\u043B\u044C\u0441", "\u0411\u0430\u043B\u0430\u043A\u043E\u0432\u043E", "\u0411\u0430\u043B\u0430\u0448\u043E\u0432", "\u0412\u043E\u043B\u044C\u0441\u043A", "\u041F\u0443\u0433\u0430\u0447\u0451\u0432", "\u0420\u0442\u0438\u0449\u0435\u0432\u043E", "\u041C\u0430\u0440\u043A\u0441", "\u041A\u0440\u0430\u0441\u043D\u043E\u0430\u0440\u043C\u0435\u0439\u0441\u043A", "\u0410\u0442\u043A\u0430\u0440\u0441\u043A", "\u041F\u0435\u0442\u0440\u043E\u0432\u0441\u043A", "\u0425\u0432\u0430\u043B\u044B\u043D\u0441\u043A", "\u0410\u0440\u043A\u0430\u0434\u0430\u043A", "\u041A\u0430\u043B\u0438\u043D\u0438\u043D\u0441\u043A"],
  "\u0421\u0430\u0445\u0430\u043B\u0438\u043D\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u042E\u0436\u043D\u043E-\u0421\u0430\u0445\u0430\u043B\u0438\u043D\u0441\u043A", "\u0425\u043E\u043B\u043C\u0441\u043A", "\u041A\u043E\u0440\u0441\u0430\u043A\u043E\u0432", "\u041E\u0445\u0430", "\u0410\u043B\u0435\u043A\u0441\u0430\u043D\u0434\u0440\u043E\u0432\u0441\u043A-\u0421\u0430\u0445\u0430\u043B\u0438\u043D\u0441\u043A\u0438\u0439", "\u041F\u043E\u0440\u043E\u043D\u0430\u0439\u0441\u043A", "\u0414\u043E\u043B\u0438\u043D\u0441\u043A", "\u041D\u0435\u0432\u0435\u043B\u044C\u0441\u043A", "\u0410\u043D\u0438\u0432\u0430"],
  "\u0421\u0432\u0435\u0440\u0434\u043B\u043E\u0432\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0415\u043A\u0430\u0442\u0435\u0440\u0438\u043D\u0431\u0443\u0440\u0433", "\u041D\u0438\u0436\u043D\u0438\u0439 \u0422\u0430\u0433\u0438\u043B", "\u041A\u0430\u043C\u0435\u043D\u0441\u043A-\u0423\u0440\u0430\u043B\u044C\u0441\u043A\u0438\u0439", "\u041F\u0435\u0440\u0432\u043E\u0443\u0440\u0430\u043B\u044C\u0441\u043A", "\u0421\u0435\u0440\u043E\u0432", "\u041D\u043E\u0432\u043E\u0443\u0440\u0430\u043B\u044C\u0441\u043A", "\u0420\u0435\u0432\u0434\u0430", "\u0410\u0441\u0431\u0435\u0441\u0442", "\u0411\u0435\u0440\u0435\u0437\u043E\u0432\u0441\u043A\u0438\u0439", "\u0412\u0435\u0440\u0445\u043D\u044F\u044F \u041F\u044B\u0448\u043C\u0430", "\u041A\u0440\u0430\u0441\u043D\u043E\u0442\u0443\u0440\u044C\u0438\u043D\u0441\u043A", "\u041B\u0435\u0441\u043D\u043E\u0439", "\u041D\u0435\u0432\u044C\u044F\u043D\u0441\u043A", "\u0410\u0440\u0442\u0451\u043C\u043E\u0432\u0441\u043A\u0438\u0439", "\u0418\u0440\u0431\u0438\u0442", "\u041A\u0430\u0447\u043A\u0430\u043D\u0430\u0440", "\u041A\u0443\u0448\u0432\u0430", "\u041F\u043E\u043B\u0435\u0432\u0441\u043A\u043E\u0439", "\u0411\u043E\u0433\u0434\u0430\u043D\u043E\u0432\u0438\u0447", "\u041A\u0440\u0430\u0441\u043D\u043E\u0443\u0444\u0438\u043C\u0441\u043A", "\u0410\u043B\u0430\u043F\u0430\u0435\u0432\u0441\u043A", "\u0421\u0440\u0435\u0434\u043D\u0435\u0443\u0440\u0430\u043B\u044C\u0441\u043A", "\u0420\u0435\u0436", "\u0417\u0430\u0440\u0435\u0447\u043D\u044B\u0439", "\u0412\u0435\u0440\u0445\u043D\u044F\u044F \u0421\u0430\u043B\u0434\u0430", "\u041A\u0430\u043C\u044B\u0448\u043B\u043E\u0432", "\u041A\u0438\u0440\u043E\u0432\u0433\u0440\u0430\u0434", "\u0422\u0430\u0432\u0434\u0430", "\u0421\u0435\u0432\u0435\u0440\u043E\u0443\u0440\u0430\u043B\u044C\u0441\u043A", "\u0421\u0443\u0445\u043E\u0439 \u041B\u043E\u0433", "\u0410\u0440\u0430\u043C\u0438\u043B\u044C", "\u0414\u0435\u0433\u0442\u044F\u0440\u0441\u043A", "\u0412\u043E\u043B\u0447\u0430\u043D\u0441\u043A"],
  "\u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430 \u0421\u0435\u0432\u0435\u0440\u043D\u0430\u044F \u041E\u0441\u0435\u0442\u0438\u044F \u2014 \u0410\u043B\u0430\u043D\u0438\u044F": ["\u0412\u043B\u0430\u0434\u0438\u043A\u0430\u0432\u043A\u0430\u0437", "\u041C\u043E\u0437\u0434\u043E\u043A", "\u0411\u0435\u0441\u043B\u0430\u043D", "\u0410\u043B\u0430\u0433\u0438\u0440", "\u0410\u0440\u0434\u043E\u043D", "\u0414\u0438\u0433\u043E\u0440\u0430"],
  "\u0421\u043C\u043E\u043B\u0435\u043D\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0421\u043C\u043E\u043B\u0435\u043D\u0441\u043A", "\u0412\u044F\u0437\u044C\u043C\u0430", "\u0420\u043E\u0441\u043B\u0430\u0432\u043B\u044C", "\u042F\u0440\u0446\u0435\u0432\u043E", "\u0414\u043E\u0440\u043E\u0433\u043E\u0431\u0443\u0436", "\u0421\u0430\u0444\u043E\u043D\u043E\u0432\u043E", "\u0414\u0435\u0441\u043D\u043E\u0433\u043E\u0440\u0441\u043A", "\u0413\u0430\u0433\u0430\u0440\u0438\u043D", "\u041F\u043E\u0447\u0438\u043D\u043E\u043A", "\u0414\u0435\u043C\u0438\u0434\u043E\u0432"],
  "\u0421\u0442\u0430\u0432\u0440\u043E\u043F\u043E\u043B\u044C\u0441\u043A\u0438\u0439 \u043A\u0440\u0430\u0439": ["\u0421\u0442\u0430\u0432\u0440\u043E\u043F\u043E\u043B\u044C", "\u041F\u044F\u0442\u0438\u0433\u043E\u0440\u0441\u043A", "\u041A\u0438\u0441\u043B\u043E\u0432\u043E\u0434\u0441\u043A", "\u041D\u0435\u0432\u0438\u043D\u043D\u043E\u043C\u044B\u0441\u0441\u043A", "\u0415\u0441\u0441\u0435\u043D\u0442\u0443\u043A\u0438", "\u041C\u0438\u043D\u0435\u0440\u0430\u043B\u044C\u043D\u044B\u0435 \u0412\u043E\u0434\u044B", "\u0413\u0435\u043E\u0440\u0433\u0438\u0435\u0432\u0441\u043A", "\u0411\u0443\u0434\u0435\u043D\u043D\u043E\u0432\u0441\u043A", "\u041C\u0438\u0445\u0430\u0439\u043B\u043E\u0432\u0441\u043A", "\u0421\u0432\u0435\u0442\u043B\u043E\u0433\u0440\u0430\u0434", "\u041B\u0435\u0440\u043C\u043E\u043D\u0442\u043E\u0432", "\u0416\u0435\u043B\u0435\u0437\u043D\u043E\u0432\u043E\u0434\u0441\u043A", "\u0418\u0437\u043E\u0431\u0438\u043B\u044C\u043D\u044B\u0439", "\u041D\u043E\u0432\u043E\u043F\u0430\u0432\u043B\u043E\u0432\u0441\u043A", "\u0411\u043B\u0430\u0433\u043E\u0434\u0430\u0440\u043D\u044B\u0439", "\u0417\u0435\u043B\u0435\u043D\u043E\u043A\u0443\u043C\u0441\u043A", "\u041D\u0435\u0444\u0442\u0435\u043A\u0443\u043C\u0441\u043A", "\u0418\u043F\u0430\u0442\u043E\u0432\u043E"],
  "\u0422\u0430\u043C\u0431\u043E\u0432\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0422\u0430\u043C\u0431\u043E\u0432", "\u041C\u0438\u0447\u0443\u0440\u0438\u043D\u0441\u043A", "\u0420\u0430\u0441\u0441\u043A\u0430\u0437\u043E\u0432\u043E", "\u041C\u043E\u0440\u0448\u0430\u043D\u0441\u043A", "\u041A\u043E\u0442\u043E\u0432\u0441\u043A", "\u0423\u0432\u0430\u0440\u043E\u0432\u043E", "\u0416\u0435\u0440\u0434\u0435\u0432\u043A\u0430"],
  "\u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430 \u0422\u0430\u0442\u0430\u0440\u0441\u0442\u0430\u043D": ["\u041A\u0430\u0437\u0430\u043D\u044C", "\u041D\u0430\u0431\u0435\u0440\u0435\u0436\u043D\u044B\u0435 \u0427\u0435\u043B\u043D\u044B", "\u041D\u0438\u0436\u043D\u0435\u043A\u0430\u043C\u0441\u043A", "\u0410\u043B\u044C\u043C\u0435\u0442\u044C\u0435\u0432\u0441\u043A", "\u0417\u0435\u043B\u0435\u043D\u043E\u0434\u043E\u043B\u044C\u0441\u043A", "\u0411\u0443\u0433\u0443\u043B\u044C\u043C\u0430", "\u0415\u043B\u0430\u0431\u0443\u0433\u0430", "\u041B\u0435\u043D\u0438\u043D\u043E\u0433\u043E\u0440\u0441\u043A", "\u0427\u0438\u0441\u0442\u043E\u043F\u043E\u043B\u044C", "\u0417\u0430\u0438\u043D\u0441\u043A", "\u041D\u0443\u0440\u043B\u0430\u0442", "\u0410\u0437\u043D\u0430\u043A\u0430\u0435\u0432\u043E", "\u0411\u0430\u0432\u043B\u044B", "\u041C\u0435\u043D\u0437\u0435\u043B\u0438\u043D\u0441\u043A", "\u0411\u0443\u0438\u043D\u0441\u043A", "\u0410\u0440\u0441\u043A", "\u041C\u0435\u043D\u0434\u0435\u043B\u0435\u0435\u0432\u0441\u043A", "\u0411\u043E\u043B\u0433\u0430\u0440", "\u0418\u043D\u043D\u043E\u043F\u043E\u043B\u0438\u0441", "\u0410\u0433\u0440\u044B\u0437", "\u041C\u0430\u043C\u0430\u0434\u044B\u0448"],
  "\u0422\u0432\u0435\u0440\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0422\u0432\u0435\u0440\u044C", "\u0420\u0436\u0435\u0432", "\u0412\u044B\u0448\u043D\u0438\u0439 \u0412\u043E\u043B\u043E\u0447\u0451\u043A", "\u0422\u043E\u0440\u0436\u043E\u043A", "\u041A\u0438\u043C\u0440\u044B", "\u041A\u043E\u043D\u0430\u043A\u043E\u0432\u043E", "\u0411\u0435\u0436\u0435\u0446\u043A", "\u0423\u0434\u043E\u043C\u043B\u044F", "\u041A\u0430\u0448\u0438\u043D", "\u041D\u0435\u043B\u0438\u0434\u043E\u0432\u043E", "\u041E\u0441\u0442\u0430\u0448\u043A\u043E\u0432", "\u0411\u043E\u043B\u043E\u0433\u043E\u0435", "\u0417\u0430\u043F\u0430\u0434\u043D\u0430\u044F \u0414\u0432\u0438\u043D\u0430", "\u0410\u043D\u0434\u0440\u0435\u0430\u043F\u043E\u043B\u044C"],
  "\u0422\u043E\u043C\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0422\u043E\u043C\u0441\u043A", "\u0421\u0435\u0432\u0435\u0440\u0441\u043A", "\u0421\u0442\u0440\u0435\u0436\u0435\u0432\u043E\u0439", "\u041A\u043E\u043B\u043F\u0430\u0448\u0435\u0432\u043E", "\u0410\u0441\u0438\u043D\u043E"],
  "\u0422\u0443\u043B\u044C\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0422\u0443\u043B\u0430", "\u041D\u043E\u0432\u043E\u043C\u043E\u0441\u043A\u043E\u0432\u0441\u043A", "\u0414\u043E\u043D\u0441\u043A\u043E\u0439", "\u0410\u043B\u0435\u043A\u0441\u0438\u043D", "\u0429\u0451\u043A\u0438\u043D\u043E", "\u0415\u0444\u0440\u0435\u043C\u043E\u0432", "\u0411\u043E\u0433\u043E\u0440\u043E\u0434\u0438\u0446\u043A", "\u0411\u0435\u043B\u0451\u0432", "\u0423\u0437\u043B\u043E\u0432\u0430\u044F", "\u042F\u0441\u043D\u043E\u0433\u043E\u0440\u0441\u043A", "\u0421\u0443\u0432\u043E\u0440\u043E\u0432", "\u041A\u0438\u0440\u0435\u0435\u0432\u0441\u043A", "\u041A\u0438\u043C\u043E\u0432\u0441\u043A", "\u0411\u043E\u043B\u043E\u0445\u043E\u0432\u043E"],
  "\u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430 \u0422\u044B\u0432\u0430": ["\u041A\u044B\u0437\u044B\u043B", "\u0410\u043A-\u0414\u043E\u0432\u0443\u0440\u0430\u043A", "\u0428\u0430\u0433\u043E\u043D\u0430\u0440", "\u0427\u0430\u0434\u0430\u043D"],
  "\u0422\u044E\u043C\u0435\u043D\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0422\u044E\u043C\u0435\u043D\u044C", "\u0422\u043E\u0431\u043E\u043B\u044C\u0441\u043A", "\u0418\u0448\u0438\u043C", "\u042F\u043B\u0443\u0442\u043E\u0440\u043E\u0432\u0441\u043A", "\u0417\u0430\u0432\u043E\u0434\u043E\u0443\u043A\u043E\u0432\u0441\u043A"],
  "\u0423\u0434\u043C\u0443\u0440\u0442\u0441\u043A\u0430\u044F \u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430": ["\u0418\u0436\u0435\u0432\u0441\u043A", "\u0421\u0430\u0440\u0430\u043F\u0443\u043B", "\u0413\u043B\u0430\u0437\u043E\u0432", "\u0412\u043E\u0442\u043A\u0438\u043D\u0441\u043A", "\u041C\u043E\u0436\u0433\u0430", "\u041A\u0430\u043C\u0431\u0430\u0440\u043A\u0430"],
  "\u0423\u043B\u044C\u044F\u043D\u043E\u0432\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0423\u043B\u044C\u044F\u043D\u043E\u0432\u0441\u043A", "\u0414\u0438\u043C\u0438\u0442\u0440\u043E\u0432\u0433\u0440\u0430\u0434", "\u0418\u043D\u0437\u0430", "\u0411\u0430\u0440\u044B\u0448", "\u041D\u043E\u0432\u043E\u0443\u043B\u044C\u044F\u043D\u043E\u0432\u0441\u043A"],
  "\u0425\u0430\u0431\u0430\u0440\u043E\u0432\u0441\u043A\u0438\u0439 \u043A\u0440\u0430\u0439": ["\u0425\u0430\u0431\u0430\u0440\u043E\u0432\u0441\u043A", "\u041A\u043E\u043C\u0441\u043E\u043C\u043E\u043B\u044C\u0441\u043A-\u043D\u0430-\u0410\u043C\u0443\u0440\u0435", "\u0410\u043C\u0443\u0440\u0441\u043A", "\u0421\u043E\u0432\u0435\u0442\u0441\u043A\u0430\u044F \u0413\u0430\u0432\u0430\u043D\u044C", "\u041D\u0438\u043A\u043E\u043B\u0430\u0435\u0432\u0441\u043A-\u043D\u0430-\u0410\u043C\u0443\u0440\u0435", "\u0411\u0438\u043A\u0438\u043D", "\u0412\u044F\u0437\u0435\u043C\u0441\u043A\u0438\u0439"],
  "\u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430 \u0425\u0430\u043A\u0430\u0441\u0438\u044F": ["\u0410\u0431\u0430\u043A\u0430\u043D", "\u0427\u0435\u0440\u043D\u043E\u0433\u043E\u0440\u0441\u043A", "\u0421\u0430\u044F\u043D\u043E\u0433\u043E\u0440\u0441\u043A", "\u0410\u0431\u0430\u0437\u0430", "\u0421\u043E\u0440\u0441\u043A"],
  "\u0425\u0430\u043D\u0442\u044B-\u041C\u0430\u043D\u0441\u0438\u0439\u0441\u043A\u0438\u0439 \u0430\u0432\u0442\u043E\u043D\u043E\u043C\u043D\u044B\u0439 \u043E\u043A\u0440\u0443\u0433": ["\u0421\u0443\u0440\u0433\u0443\u0442", "\u041D\u0438\u0436\u043D\u0435\u0432\u0430\u0440\u0442\u043E\u0432\u0441\u043A", "\u0425\u0430\u043D\u0442\u044B-\u041C\u0430\u043D\u0441\u0438\u0439\u0441\u043A", "\u041D\u0435\u0444\u0442\u0435\u044E\u0433\u0430\u043D\u0441\u043A", "\u041D\u044F\u0433\u0430\u043D\u044C", "\u041C\u0435\u0433\u0438\u043E\u043D", "\u041A\u043E\u0433\u0430\u043B\u044B\u043C", "\u0420\u0430\u0434\u0443\u0436\u043D\u044B\u0439", "\u0423\u0440\u0430\u0439", "\u041B\u0430\u043D\u0433\u0435\u043F\u0430\u0441", "\u041F\u044B\u0442\u044C-\u042F\u0445", "\u042E\u0433\u043E\u0440\u0441\u043A", "\u041F\u043E\u043A\u0430\u0447\u0438", "\u0411\u0435\u043B\u043E\u044F\u0440\u0441\u043A\u0438\u0439", "\u0421\u043E\u0432\u0435\u0442\u0441\u043A\u0438\u0439"],
  "\u0427\u0435\u043B\u044F\u0431\u0438\u043D\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u0427\u0435\u043B\u044F\u0431\u0438\u043D\u0441\u043A", "\u041C\u0430\u0433\u043D\u0438\u0442\u043E\u0433\u043E\u0440\u0441\u043A", "\u0417\u043B\u0430\u0442\u043E\u0443\u0441\u0442", "\u041C\u0438\u0430\u0441\u0441", "\u041A\u043E\u043F\u0435\u0439\u0441\u043A", "\u041E\u0437\u0451\u0440\u0441\u043A", "\u0421\u043D\u0435\u0436\u0438\u043D\u0441\u043A", "\u0422\u0440\u043E\u0438\u0446\u043A", "\u0423\u0441\u0442\u044C-\u041A\u0430\u0442\u0430\u0432", "\u0427\u0435\u0431\u0430\u0440\u043A\u0443\u043B\u044C", "\u0421\u0430\u0442\u043A\u0430", "\u042E\u0436\u043D\u043E\u0443\u0440\u0430\u043B\u044C\u0441\u043A", "\u041A\u043E\u0440\u043A\u0438\u043D\u043E", "\u041A\u044B\u0448\u0442\u044B\u043C", "\u0410\u0448\u0430", "\u0422\u0440\u0451\u0445\u0433\u043E\u0440\u043D\u044B\u0439", "\u041A\u0430\u0441\u043B\u0438", "\u0412\u0435\u0440\u0445\u043D\u0438\u0439 \u0423\u0444\u0430\u043B\u0435\u0439", "\u041A\u0430\u0440\u0430\u0431\u0430\u0448", "\u0415\u043C\u0430\u043D\u0436\u0435\u043B\u0438\u043D\u0441\u043A", "\u041F\u043B\u0430\u0441\u0442", "\u041A\u0430\u0442\u0430\u0432-\u0418\u0432\u0430\u043D\u043E\u0432\u0441\u043A", "\u041D\u044F\u0437\u0435\u043F\u0435\u0442\u0440\u043E\u0432\u0441\u043A", "\u041C\u0438\u043D\u044C\u044F\u0440"],
  "\u0427\u0435\u0447\u0435\u043D\u0441\u043A\u0430\u044F \u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430": ["\u0413\u0440\u043E\u0437\u043D\u044B\u0439", "\u0413\u0443\u0434\u0435\u0440\u043C\u0435\u0441", "\u0423\u0440\u0443\u0441-\u041C\u0430\u0440\u0442\u0430\u043D", "\u0428\u0430\u043B\u0438", "\u0410\u0440\u0433\u0443\u043D"],
  "\u0427\u0443\u0432\u0430\u0448\u0441\u043A\u0430\u044F \u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430": ["\u0427\u0435\u0431\u043E\u043A\u0441\u0430\u0440\u044B", "\u041D\u043E\u0432\u043E\u0447\u0435\u0431\u043E\u043A\u0441\u0430\u0440\u0441\u043A", "\u041A\u0430\u043D\u0430\u0448", "\u0410\u043B\u0430\u0442\u044B\u0440\u044C", "\u0428\u0443\u043C\u0435\u0440\u043B\u044F", "\u0426\u0438\u0432\u0438\u043B\u044C\u0441\u043A", "\u041C\u0430\u0440\u0438\u0438\u043D\u0441\u043A\u0438\u0439 \u041F\u043E\u0441\u0430\u0434"],
  "\u0427\u0443\u043A\u043E\u0442\u0441\u043A\u0438\u0439 \u0430\u0432\u0442\u043E\u043D\u043E\u043C\u043D\u044B\u0439 \u043E\u043A\u0440\u0443\u0433": ["\u0410\u043D\u0430\u0434\u044B\u0440\u044C"],
  "\u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430 \u0421\u0430\u0445\u0430 (\u042F\u043A\u0443\u0442\u0438\u044F)": ["\u042F\u043A\u0443\u0442\u0441\u043A", "\u041C\u0438\u0440\u043D\u044B\u0439", "\u041D\u0435\u0440\u044E\u043D\u0433\u0440\u0438", "\u0410\u043B\u0434\u0430\u043D", "\u041B\u0435\u043D\u0441\u043A", "\u041D\u044E\u0440\u0431\u0430", "\u041F\u043E\u043A\u0440\u043E\u0432\u0441\u043A"],
  "\u042F\u043C\u0430\u043B\u043E-\u041D\u0435\u043D\u0435\u0446\u043A\u0438\u0439 \u0430\u0432\u0442\u043E\u043D\u043E\u043C\u043D\u044B\u0439 \u043E\u043A\u0440\u0443\u0433": ["\u041D\u043E\u0432\u044B\u0439 \u0423\u0440\u0435\u043D\u0433\u043E\u0439", "\u041D\u043E\u044F\u0431\u0440\u044C\u0441\u043A", "\u0421\u0430\u043B\u0435\u0445\u0430\u0440\u0434", "\u041D\u0430\u0434\u044B\u043C", "\u041C\u0443\u0440\u0430\u0432\u043B\u0435\u043D\u043A\u043E", "\u041B\u0430\u0431\u044B\u0442\u043D\u0430\u043D\u0433\u0438", "\u0413\u0443\u0431\u043A\u0438\u043D\u0441\u043A\u0438\u0439", "\u0422\u0430\u0440\u043A\u043E-\u0421\u0430\u043B\u0435"],
  "\u042F\u0440\u043E\u0441\u043B\u0430\u0432\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C": ["\u042F\u0440\u043E\u0441\u043B\u0430\u0432\u043B\u044C", "\u0420\u044B\u0431\u0438\u043D\u0441\u043A", "\u041F\u0435\u0440\u0435\u0441\u043B\u0430\u0432\u043B\u044C-\u0417\u0430\u043B\u0435\u0441\u0441\u043A\u0438\u0439", "\u0422\u0443\u0442\u0430\u0435\u0432", "\u0423\u0433\u043B\u0438\u0447", "\u0420\u043E\u0441\u0442\u043E\u0432", "\u0413\u0430\u0432\u0440\u0438\u043B\u043E\u0432-\u042F\u043C", "\u0414\u0430\u043D\u0438\u043B\u043E\u0432", "\u041C\u044B\u0448\u043A\u0438\u043D"],
  "\u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430 \u0418\u043D\u0433\u0443\u0448\u0435\u0442\u0438\u044F": ["\u041C\u0430\u0433\u0430\u0441", "\u041D\u0430\u0437\u0440\u0430\u043D\u044C", "\u041C\u0430\u043B\u0433\u043E\u0431\u0435\u043A", "\u041A\u0430\u0440\u0430\u0431\u0443\u043B\u0430\u043A"],
  "\u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430 \u041A\u0440\u044B\u043C": ["\u0421\u0438\u043C\u0444\u0435\u0440\u043E\u043F\u043E\u043B\u044C", "\u041A\u0435\u0440\u0447\u044C", "\u0415\u0432\u043F\u0430\u0442\u043E\u0440\u0438\u044F", "\u042F\u043B\u0442\u0430", "\u0424\u0435\u043E\u0434\u043E\u0441\u0438\u044F", "\u0414\u0436\u0430\u043D\u043A\u043E\u0439", "\u0410\u043B\u0443\u0448\u0442\u0430", "\u0411\u0430\u0445\u0447\u0438\u0441\u0430\u0440\u0430\u0439", "\u0421\u0430\u043A\u0438", "\u041A\u0440\u0430\u0441\u043D\u043E\u043F\u0435\u0440\u0435\u043A\u043E\u043F\u0441\u043A", "\u0410\u0440\u043C\u044F\u043D\u0441\u043A", "\u0421\u0443\u0434\u0430\u043A"]
};
var TOP_CITIES = [
  "\u041C\u043E\u0441\u043A\u0432\u0430",
  "\u0421\u0430\u043D\u043A\u0442-\u041F\u0435\u0442\u0435\u0440\u0431\u0443\u0440\u0433",
  "\u041D\u043E\u0432\u043E\u0441\u0438\u0431\u0438\u0440\u0441\u043A",
  "\u0415\u043A\u0430\u0442\u0435\u0440\u0438\u043D\u0431\u0443\u0440\u0433",
  "\u041A\u0430\u0437\u0430\u043D\u044C",
  "\u041D\u0438\u0436\u043D\u0438\u0439 \u041D\u043E\u0432\u0433\u043E\u0440\u043E\u0434",
  "\u041A\u0440\u0430\u0441\u043D\u043E\u044F\u0440\u0441\u043A",
  "\u0427\u0435\u043B\u044F\u0431\u0438\u043D\u0441\u043A",
  "\u0421\u0430\u043C\u0430\u0440\u0430",
  "\u0423\u0444\u0430",
  "\u0420\u043E\u0441\u0442\u043E\u0432-\u043D\u0430-\u0414\u043E\u043D\u0443",
  "\u041A\u0440\u0430\u0441\u043D\u043E\u0434\u0430\u0440",
  "\u041E\u043C\u0441\u043A",
  "\u0412\u043E\u0440\u043E\u043D\u0435\u0436",
  "\u041F\u0435\u0440\u043C\u044C",
  "\u0412\u043E\u043B\u0433\u043E\u0433\u0440\u0430\u0434",
  "\u0421\u0430\u0440\u0430\u0442\u043E\u0432",
  "\u0422\u044E\u043C\u0435\u043D\u044C",
  "\u0422\u043E\u043B\u044C\u044F\u0442\u0442\u0438",
  "\u0418\u0436\u0435\u0432\u0441\u043A",
  "\u0411\u0430\u0440\u043D\u0430\u0443\u043B",
  "\u0423\u043B\u044C\u044F\u043D\u043E\u0432\u0441\u043A",
  "\u0418\u0440\u043A\u0443\u0442\u0441\u043A",
  "\u0425\u0430\u0431\u0430\u0440\u043E\u0432\u0441\u043A",
  "\u042F\u0440\u043E\u0441\u043B\u0430\u0432\u043B\u044C",
  "\u0412\u043B\u0430\u0434\u0438\u0432\u043E\u0441\u0442\u043E\u043A",
  "\u041C\u0430\u0445\u0430\u0447\u043A\u0430\u043B\u0430",
  "\u0422\u043E\u043C\u0441\u043A",
  "\u041E\u0440\u0435\u043D\u0431\u0443\u0440\u0433",
  "\u041A\u0435\u043C\u0435\u0440\u043E\u0432\u043E",
  "\u041D\u043E\u0432\u043E\u043A\u0443\u0437\u043D\u0435\u0446\u043A",
  "\u0420\u044F\u0437\u0430\u043D\u044C",
  "\u0410\u0441\u0442\u0440\u0430\u0445\u0430\u043D\u044C",
  "\u041D\u0430\u0431\u0435\u0440\u0435\u0436\u043D\u044B\u0435 \u0427\u0435\u043B\u043D\u044B",
  "\u041F\u0435\u043D\u0437\u0430",
  "\u041B\u0438\u043F\u0435\u0446\u043A",
  "\u041A\u0438\u0440\u043E\u0432",
  "\u0427\u0435\u0431\u043E\u043A\u0441\u0430\u0440\u044B",
  "\u0422\u0443\u043B\u0430",
  "\u041A\u0430\u043B\u0438\u043D\u0438\u043D\u0433\u0440\u0430\u0434",
  "\u0411\u0430\u043B\u0430\u0448\u0438\u0445\u0430",
  "\u041A\u0443\u0440\u0441\u043A",
  "\u0421\u0435\u0432\u0430\u0441\u0442\u043E\u043F\u043E\u043B\u044C",
  "\u0423\u043B\u0430\u043D-\u0423\u0434\u044D",
  "\u0421\u0442\u0430\u0432\u0440\u043E\u043F\u043E\u043B\u044C",
  "\u0421\u043E\u0447\u0438",
  "\u0422\u0432\u0435\u0440\u044C",
  "\u041C\u0430\u0433\u043D\u0438\u0442\u043E\u0433\u043E\u0440\u0441\u043A",
  "\u0418\u0432\u0430\u043D\u043E\u0432\u043E",
  "\u0411\u0440\u044F\u043D\u0441\u043A",
  "\u0411\u0435\u043B\u0433\u043E\u0440\u043E\u0434",
  "\u0421\u0443\u0440\u0433\u0443\u0442",
  "\u0412\u043B\u0430\u0434\u0438\u043C\u0438\u0440",
  "\u041D\u0438\u0436\u043D\u0438\u0439 \u0422\u0430\u0433\u0438\u043B",
  "\u0410\u0440\u0445\u0430\u043D\u0433\u0435\u043B\u044C\u0441\u043A",
  "\u0427\u0438\u0442\u0430",
  "\u0421\u0438\u043C\u0444\u0435\u0440\u043E\u043F\u043E\u043B\u044C",
  "\u041A\u0430\u043B\u0443\u0433\u0430",
  "\u0421\u043C\u043E\u043B\u0435\u043D\u0441\u043A",
  "\u0412\u043E\u043B\u0436\u0441\u043A\u0438\u0439",
  "\u041A\u0443\u0440\u0433\u0430\u043D",
  "\u041E\u0440\u0451\u043B",
  "\u0427\u0435\u0440\u0435\u043F\u043E\u0432\u0435\u0446",
  "\u0412\u043E\u043B\u043E\u0433\u0434\u0430",
  "\u0412\u043B\u0430\u0434\u0438\u043A\u0430\u0432\u043A\u0430\u0437",
  "\u0421\u0430\u0440\u0430\u043D\u0441\u043A",
  "\u041C\u0443\u0440\u043C\u0430\u043D\u0441\u043A",
  "\u042F\u043A\u0443\u0442\u0441\u043A",
  "\u041F\u043E\u0434\u043E\u043B\u044C\u0441\u043A",
  "\u0413\u0440\u043E\u0437\u043D\u044B\u0439"
];

// server/cities.ts
var CITIES = Object.entries(CITIES_BY_REGION).flatMap(
  ([region, names]) => names.map((name) => {
    const idx = TOP_CITIES.indexOf(name);
    return { id: `${name}|${region}`, name, region, n: norm(name), rank: idx === -1 ? 999 : idx };
  })
);
var BY_ID = new Map(CITIES.map((c) => [c.id, c]));
var findCity = (id) => BY_ID.get(id) ?? null;
var cityTier = (c) => c.rank < 15 ? "big" : c.rank < 60 ? "mid" : "small";
var EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
var RU = "\u0439\u0446\u0443\u043A\u0435\u043D\u0433\u0448\u0449\u0437\u0445\u044A\u0444\u044B\u0432\u0430\u043F\u0440\u043E\u043B\u0434\u0436\u044D\u044F\u0447\u0441\u043C\u0438\u0442\u044C\u0431\u044E\u0451";
var LAYOUT = new Map([...EN].map((ch, i) => [ch, RU[i]]));
var fixLayout = (s) => [...s.toLowerCase()].map((ch) => LAYOUT.get(ch) ?? ch).join("");
function osa(a, b) {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > 2) return 3;
  const d = Array.from({ length: al + 1 }, () => new Array(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) d[i][0] = i;
  for (let j = 0; j <= bl; j++) d[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[al][bl];
}
function score(n, v) {
  if (n === v) return 80;
  if (n.startsWith(v)) return 80;
  const words = n.split(" ");
  if (words.some((w) => w.startsWith(v))) return 60;
  if (n.includes(v)) return 40;
  if (v.length >= 4) {
    const maxEdits = v.length >= 7 ? 2 : 1;
    const close = (target) => {
      for (const len of [v.length, v.length + 1, v.length - 1]) if (osa(v, target.slice(0, len)) <= maxEdits) return true;
      return false;
    };
    if (close(n)) return 30;
    if (words.some(close)) return 25;
  }
  return 0;
}
function searchCities(q, limit = 8) {
  const base = norm(q);
  const out = (cs) => cs.slice(0, limit).map(({ id, name, region }) => ({ id, name, region }));
  if (!base) return out(CITIES.filter((c) => c.rank < 999).sort((a, b) => a.rank - b.rank));
  const variants = /* @__PURE__ */ new Set([base, norm(fixLayout(q))]);
  const scored = [];
  for (const c of CITIES) {
    let s = 0;
    for (const v of variants) s = Math.max(s, score(c.n, v));
    if (s) scored.push({ c, s });
  }
  const hasStrong = scored.some((x) => x.s >= 40);
  const list = hasStrong ? scored.filter((x) => x.s >= 40) : scored;
  list.sort((a, b) => b.s - a.s || a.c.rank - b.c.rank || a.c.name.localeCompare(b.c.name, "ru"));
  return out(list.map((x) => x.c));
}

// server/providers.ts
var PREFIX = ["\u041F\u0440\u043E\u0444\u0438", "\u041C\u0430\u0441\u0442\u0435\u0440", "\u0426\u0435\u043D\u0442\u0440", "\u042D\u043A\u0441\u043F\u0435\u0440\u0442", "\u0410\u043B\u044C\u0444\u0430", "\u0413\u0430\u0440\u0430\u043D\u0442", "\u041B\u0438\u0434\u0435\u0440", "\u0412\u0435\u043A\u0442\u043E\u0440", "\u0421\u043E\u044E\u0437", "\u041D\u043E\u0440\u043C\u0430"];
var STREETS = ["\u041B\u0435\u043D\u0438\u043D\u0430", "\u041C\u0438\u0440\u0430", "\u0421\u043E\u0432\u0435\u0442\u0441\u043A\u0430\u044F", "\u0413\u0430\u0433\u0430\u0440\u0438\u043D\u0430", "\u041F\u0440\u043E\u043C\u044B\u0448\u043B\u0435\u043D\u043D\u0430\u044F", "\u0426\u0435\u043D\u0442\u0440\u0430\u043B\u044C\u043D\u0430\u044F", "\u0428\u043A\u043E\u043B\u044C\u043D\u0430\u044F", "\u0417\u0430\u0432\u043E\u0434\u0441\u043A\u0430\u044F", "\u041A\u0438\u0440\u043E\u0432\u0430", "\u041F\u043E\u0431\u0435\u0434\u044B"];
var NAMES = ["\u0410\u043B\u0435\u043A\u0441\u0435\u0439", "\u041C\u0430\u0440\u0438\u044F", "\u0414\u043C\u0438\u0442\u0440\u0438\u0439", "\u0410\u043D\u043D\u0430", "\u0421\u0435\u0440\u0433\u0435\u0439", "\u041E\u043B\u044C\u0433\u0430", "\u0418\u0432\u0430\u043D", "\u0415\u043B\u0435\u043D\u0430", "\u0410\u043D\u0434\u0440\u0435\u0439", "\u041D\u0430\u0442\u0430\u043B\u044C\u044F"];
var DEMO_CAP = 300;
function demoMaps(niche, city) {
  const r = mulberry32(hashStr(`${niche.toLowerCase().trim()}|${city.id}`));
  const [lo, hi] = { big: [900, 2600], mid: [300, 950], small: [40, 320] }[cityTier(city)];
  const total = rint(r, lo, hi);
  const withoutSite = Math.round(total * (0.28 + r() * 0.24));
  return { stats: { total, withoutSite, withPhone: Math.round(withoutSite * (0.7 + r() * 0.22)) } };
}
function demoMapsRow(rec, i) {
  const r = mulberry32(hashStr(`${rec.seed}:${i}`));
  const niche = rec.query.niche || "\u041A\u043E\u043C\u043F\u0430\u043D\u0438\u044F";
  const share = rec.stats.withPhone / Math.max(1, rec.stats.withoutSite);
  const d2 = () => String(rint(r, 0, 99)).padStart(2, "0");
  return {
    id: `demo-${i}`,
    name: `${niche[0].toUpperCase()}${niche.slice(1)} \xAB${pick(r, PREFIX)}-${rint(r, 1, 99)}\xBB`,
    category: niche,
    address: `${rec.query.cityLabel?.split(",")[0] ?? ""}, \u0443\u043B. ${pick(r, STREETS)}, ${rint(r, 1, 120)}`,
    phone: r() < share ? `+7 (900) 000-${d2()}-${d2()}` : null,
    rating: Math.round((3.8 + r() * 1.2) * 10) / 10,
    reviews: rint(r, 3, 250),
    url: null
  };
}
function demoTg(phrase, days) {
  const r = mulberry32(hashStr(`${phrase.toLowerCase().trim()}|${days}`));
  return { stats: { people: rint(r, 8, 140) * days, chats: rint(r, 4, 40) } };
}
function demoTgRow(rec, i) {
  const r = mulberry32(hashStr(`${rec.seed}:${i}`));
  const username = `demo_user_${rint(r, 1e3, 9999)}`;
  return {
    id: `demo-${i}`,
    username,
    name: pick(r, NAMES),
    chat: `\u0414\u0435\u043C\u043E-\u0447\u0430\u0442 ${rint(r, 1, rec.stats.chats)}`,
    text: `\u0418\u0449\u0443: ${rec.query.phrase}. \u041A\u0442\u043E \u043C\u043E\u0436\u0435\u0442 \u043F\u043E\u043C\u043E\u0447\u044C? \u041F\u0438\u0448\u0438\u0442\u0435 \u0432 \u043B\u0438\u0447\u043D\u044B\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F.`,
    date: new Date(Date.now() - r() * (rec.query.days ?? 3) * 864e5).toISOString(),
    link: `https://t.me/${username}`
  };
}
var SERPER = () => process.env.SERPER_API_KEY || "";
var MIN_REVIEWS = Number(process.env.MIN_REVIEWS) || 3;
var norm2 = (s) => String(s || "").toLowerCase().replace(/ё/g, "\u0435").replace(/[^a-zа-я0-9]+/g, " ").trim();
var hostOf = (u) => {
  try {
    return new URL(/^https?:\/\//i.test(u) ? u : "https://" + u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};
var AGG = ["2gis.ru", "2gis.com", "yandex.ru", "yandex.com", "ya.ru", "google.com", "google.ru", "zoon.ru", "flamp.ru", "tripadvisor.ru", "yell.ru", "orgpage.ru", "spr.ru", "vk.com", "vk.ru", "ok.ru", "instagram.com", "facebook.com", "t.me", "telegram.me", "youtube.com", "tiktok.com", "avito.ru", "hh.ru", "restoclub.ru", "wikipedia.org", "rusprofile.ru", "list-org.com", "sbis.ru", "profi.ru", "yclients.com", "dikidi.net", "booksy.com", "dzen.ru", "rutube.ru", "otzovik.com", "irecommend.ru", "checko.ru", "kontur.ru", "allbiz.ru", "cylex.ru", "pulscen.ru", "tiu.ru", "prodoctorov.ru", "docdoc.ru", "napopravku.ru", "wa.me", "linktr.ee", "taplink.cc", "booking.com"];
var isAgg = (h4) => AGG.some((d) => h4 === d || h4.endsWith("." + d));
var NOT_IP = /(?:^|[^a-zа-яё0-9])(?:гбу\w*|гку|мбу\w*|мбоу|мдоу|муп|гуп|мфц|загс|мвд|мчс|ооо|оао|зао|пао|ао|нко|тсж|жэк)(?=$|[^a-zа-яё0-9])|муниципальн|государственн|бюджетн|администрац|министерств|департамент|поликлиник|больниц|диспансер|полици|налогов|пенсионн|суд\b|школа|гимназия|лицей|колледж|детский сад|университет|библиотек|музей|театр|церковь|храм|мечеть|кладбищ|управляющая компания/iu;
var CLOSED = /закрыто навсегда|навсегда закрыт|permanently closed|прекратил[а-я]* работу|больше не работает/i;
async function serper(path2, body) {
  const r = await fetch("https://google.serper.dev/" + path2, {
    method: "POST",
    headers: { "X-API-KEY": SERPER(), "Content-Type": "application/json" },
    body: JSON.stringify({ gl: "ru", hl: "ru", ...body }),
    signal: AbortSignal.timeout(9e3)
  });
  if (!r.ok) throw new Error("Serper HTTP " + r.status);
  return r.json();
}
function phoneOf(raw) {
  const d = String(raw || "").split(/[;,]/)[0].replace(/\D/g, "");
  const t = d.length === 11 && (d[0] === "7" || d[0] === "8") ? d.slice(1) : d.length === 10 ? d : "";
  return t ? `+7 ${t.slice(0, 3)} ${t.slice(3, 6)}-${t.slice(6, 8)}-${t.slice(8)}` : "";
}
async function hasOwnSite(c, city) {
  const toks = norm2(c.name).split(" ").filter((t) => t.length >= 3);
  if (!toks.length) return false;
  const need = Math.max(1, Math.ceil(toks.length * 0.6));
  const hit = (t) => {
    const h4 = norm2(t);
    return h4.includes(norm2(c.name)) || toks.filter((x) => h4.includes(x)).length >= need;
  };
  const web = await serper("search", { q: `${c.name} ${city}`, num: 10 });
  const org = web.organic || [];
  for (const r of [web.knowledgeGraph, ...org.slice(0, 5)].filter(Boolean)) {
    const text = `${r.title || ""} ${r.description || ""} ${r.snippet || ""}`;
    if (hit(r.title || text) && CLOSED.test(text)) return true;
  }
  if (web.knowledgeGraph?.website && !isAgg(hostOf(web.knowledgeGraph.website)) && hit(web.knowledgeGraph.title || "")) return true;
  for (let i = 0; i < org.length; i++) {
    const host = hostOf(org[i].link);
    if (!host || isAgg(host)) continue;
    const hay = `${org[i].title || ""} ${org[i].snippet || ""}`;
    if (!hit(hay)) continue;
    if (norm2(hay).includes(norm2(city)) || i < 3 || toks.some((t) => t.length >= 4 && host.replace(/[^a-zа-я0-9]/g, "").includes(t))) return true;
  }
  return false;
}
async function serperMaps(niche, city, deadline) {
  const all = /* @__PURE__ */ new Map();
  const errors = [];
  const first = niche.split(/\s+и\s+|,/)[0].trim();
  const queries = [.../* @__PURE__ */ new Set([niche, first, `${first} \u0430\u0434\u0440\u0435\u0441 \u0442\u0435\u043B\u0435\u0444\u043E\u043D`])];
  const jobs = queries.flatMap((q) => [1, 2, 3].map((page) => ({ q: `${q} ${city.name}`, page })));
  for (let i = 0; i < jobs.length; i += 3) {
    if (Date.now() > deadline - 25e3) break;
    const res = await Promise.all(jobs.slice(i, i + 3).map((j) => serper("places", j).then((x) => x.places || []).catch((e) => {
      errors.push(e.message);
      return [];
    })));
    for (const p of res.flat()) {
      const name = String(p.title || "").trim();
      const address = String(p.address || "").trim();
      const id = String(p.cid || p.placeId || "").trim();
      const phone = phoneOf(p.phoneNumber || p.phone) || null;
      if (!id || name.length < 2 || all.has(id) || NOT_IP.test(`${name} ${p.category || ""}`)) continue;
      if (!/\d/.test(address)) continue;
      if (!(Number(p.ratingCount) >= MIN_REVIEWS)) continue;
      const host = p.website ? hostOf(String(p.website)) : "";
      all.set(id, { id, name, category: String(p.category || niche), address, phone, rating: Number(p.rating) || null, reviews: Number(p.ratingCount) || null, url: `https://www.google.com/maps?cid=${encodeURIComponent(id)}`, site: !!host && !isAgg(host), key: norm2(name) });
    }
  }
  if (!all.size) console.error("[maps] Serper places: 0 \u043A\u0430\u043D\u0434\u0438\u0434\u0430\u0442\u043E\u0432", errors[0] || "");
  if (!all.size && errors.length) throw new Error(errors[0]);
  const cnt = /* @__PURE__ */ new Map();
  for (const c of all.values()) for (const k of [c.key, c.phone || ""]) cnt.set(k, (cnt.get(k) || 0) + 1);
  const todo = [...all.values()].filter((c) => !c.site && cnt.get(c.key) < 2 && (!c.phone || cnt.get(c.phone) < 2));
  const rows = [];
  let failed = 0, checked = 0;
  for (let i = 0; i < todo.length && Date.now() < deadline; i += 5) {
    const batch = todo.slice(i, i + 5);
    const res = await Promise.all(batch.map((c) => hasOwnSite(c, city.name).catch((e) => {
      failed++;
      console.error("[sitecheck]", e.message);
      return null;
    })));
    checked += batch.length;
    batch.forEach((c, k) => {
      if (res[k] === false) {
        const { site, key, ...row } = c;
        rows.push(row);
      }
    });
  }
  console.log(`[maps] ${niche} / ${city.name}: \u043A\u0430\u043D\u0434\u0438\u0434\u0430\u0442\u043E\u0432 ${all.size}, \u043D\u0430 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0443 ${todo.length}, \u043F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043E ${checked}, \u043E\u0448\u0438\u0431\u043E\u043A \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 ${failed}, \u0431\u0435\u0437 \u0441\u0430\u0439\u0442\u0430 ${rows.length}`);
  if (checked > 0 && failed === checked) throw new Error("\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u0441\u0430\u0439\u0442\u043E\u0432 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430 (Serper search)");
  return { stats: { total: all.size, withoutSite: rows.length, withPhone: rows.filter((r) => r.phone).length }, rows };
}
async function searchMaps(niche, city, real) {
  if (!real) return demoMaps(niche, city);
  const deadline = Date.now() + 5e4;
  if (config.mapsProvider === "2gis") {
    if (!config.gisKey) throw new Error("MAPS_PROVIDER=2gis \u0442\u0440\u0435\u0431\u0443\u0435\u0442 GIS_API_KEY");
    return gisSearch(niche, city);
  }
  if (config.gisKey) return gisSearch(niche, city);
  if (SERPER()) return serperMaps(niche, city, deadline);
  throw new Error("\u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A \u0434\u0430\u043D\u043D\u044B\u0445 \u043D\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0451\u043D: \u0437\u0430\u0434\u0430\u0439\u0442\u0435 SERPER_API_KEY (\u0438\u043B\u0438 GIS_API_KEY)");
}
async function gisSearch(niche, city) {
  const rows = [];
  let total = 0;
  for (let page = 1; page <= 5; page++) {
    const url = new URL("https://catalog.api.2gis.com/3.0/items");
    url.searchParams.set("q", `${niche} ${city.name}`);
    url.searchParams.set("type", "branch");
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", "50");
    url.searchParams.set("fields", "items.contact_groups,items.reviews,items.address_name,items.rubrics");
    url.searchParams.set("key", config.gisKey);
    const resp = await fetch(url, { signal: AbortSignal.timeout(15e3) });
    if (!resp.ok) {
      if (page === 1) throw new Error(`2\u0413\u0418\u0421 \u043E\u0442\u0432\u0435\u0442\u0438\u043B ${resp.status}`);
      break;
    }
    const items = (await resp.json())?.result?.items ?? [];
    total += items.length;
    for (const it of items) {
      const contacts = (it.contact_groups ?? []).flatMap((g) => g.contacts ?? []);
      const phone = contacts.find((c) => c.type === "phone");
      if (contacts.some((c) => c.type === "website") || !phone) continue;
      rows.push({ id: String(it.id), name: String(it.name ?? ""), category: String(it.rubrics?.[0]?.name ?? niche), address: String(it.address_name ?? city.name), phone: String(phone.text ?? phone.value ?? "") || null, rating: it.reviews?.general_rating ?? null, reviews: it.reviews?.general_review_count ?? null, url: `https://2gis.ru/firm/${String(it.id).split("_")[0]}` });
    }
    if (items.length < 50) break;
  }
  return { stats: { total, withoutSite: rows.length, withPhone: rows.length }, rows };
}
async function searchTg(phrase, days, real) {
  if (!real) return demoTg(phrase, days);
  if (config.tgProvider !== "http") throw new Error("\u041F\u0430\u0440\u0441\u0435\u0440 Telegram \u043D\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0451\u043D: \u0437\u0430\u0434\u0430\u0439\u0442\u0435 TG_PROVIDER=http");
  let parserUrl = `${config.appUrl}/api/tg`;
  if (!process.env.VERCEL_URL && config.tgParserUrl) {
    parserUrl = config.tgParserUrl.endsWith("/api/tg") ? config.tgParserUrl : `${config.tgParserUrl}/search`;
  }
  const resp = await fetch(parserUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.tgParserKey}` },
    body: JSON.stringify({ phrase, days, budget: 35 }),
    signal: AbortSignal.timeout(55e3)
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => null);
    throw new Error(err?.detail || `TG-\u043F\u0430\u0440\u0441\u0435\u0440 \u043E\u0442\u0432\u0435\u0442\u0438\u043B ${resp.status}`);
  }
  const rows = (await resp.json()).rows ?? [];
  return {
    stats: { people: new Set(rows.map((x) => x.username || x.id)).size, chats: new Set(rows.map((x) => x.chat)).size },
    rows
  };
}
function summarize(kind, stats, rows) {
  const rowsTotal = rows ? rows.length : Math.min(kind === "maps" ? stats.withoutSite : stats.people, DEMO_CAP);
  return { rowsTotal, head: rows ? rows.slice(0, 3) : void 0 };
}
function getRows(rec, offset, limit) {
  if (!rec.demo) return (rec.rows ?? []).slice(offset, offset + limit);
  const out = [];
  for (let i = offset; i < Math.min(offset + limit, rec.rowsTotal); i++) out.push(rec.kind === "maps" ? demoMapsRow(rec, i) : demoTgRow(rec, i));
  return out;
}
var headRows = (rec) => rec.demo ? getRows(rec, 0, 3) : rec.head ?? [];

// server/appRoutes.ts
var appRouter = Router2();
var env2 = process.env;
var REPO = env2.APP_RELEASE_REPO || "";
var TOKEN = env2.APP_RELEASE_TOKEN || "";
var PLATFORMS = [
  { id: "windows", label: "Windows 10 / 11", match: "windows", envUrl: "APP_URL_WINDOWS" },
  { id: "macos-arm", label: "macOS (Apple Silicon: M1\u2013M4)", match: "macos-arm64", envUrl: "APP_URL_MACOS_ARM" },
  { id: "macos-intel", label: "macOS (Intel)", match: "macos-x64", envUrl: "APP_URL_MACOS_INTEL" },
  { id: "linux", label: "Linux (x64)", match: "linux", envUrl: "APP_URL_LINUX" }
];
var h2 = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
var mac = (uid) => crypto5.createHmac("sha256", config.sessionSecret).update("fracs-app-license:" + uid).digest("base64url").slice(0, 24);
var licenseKey = (uid) => `fracs.${Buffer.from(uid).toString("base64url")}.${mac(uid)}`;
function parseKey(key) {
  if (typeof key !== "string") return null;
  const [prefix, enc, sig] = key.trim().split(".");
  if (prefix !== "fracs" || !enc || !sig) return null;
  const uid = Buffer.from(enc, "base64url").toString();
  const expected = mac(uid);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto5.timingSafeEqual(a, b) ? uid : null;
}
var cache = null;
async function release() {
  if (!REPO || !TOKEN) return null;
  if (cache && Date.now() - cache.at < 5 * 6e4) return cache;
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(1e4)
  });
  if (!r.ok) return null;
  const j = await r.json();
  cache = { at: Date.now(), tag: String(j.tag_name || ""), assets: (j.assets || []).map((a) => ({ id: a.id, name: String(a.name), url: String(a.url) })) };
  return cache;
}
var assetFor = (rel, match) => rel?.assets.find((a) => a.name.toLowerCase().includes(match));
var needSub = (res) => res.status(402).json({ error: "subscription_required", message: "\u041F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0430 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430 \u043F\u043E \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0435." });
appRouter.get("/info", requireAuth, h2(async (req, res) => {
  const u = req.user;
  if (!isSubscribed(u)) return void needSub(res);
  const rel = await release().catch(() => null);
  res.json({
    key: licenseKey(u.id),
    until: u.subscriptionUntil,
    version: rel?.tag ?? null,
    platforms: PLATFORMS.map((p) => ({ id: p.id, label: p.label, available: Boolean(env2[p.envUrl] || assetFor(rel, p.match)) }))
  });
}));
appRouter.get("/download/:platform", requireAuth, h2(async (req, res) => {
  const u = req.user;
  if (!isSubscribed(u)) return void needSub(res);
  const p = PLATFORMS.find((x) => x.id === req.params.platform);
  if (!p) return void res.status(404).json({ error: "not_found" });
  const direct = env2[p.envUrl];
  if (direct) return void res.redirect(302, direct);
  const asset = assetFor(await release().catch(() => null), p.match);
  if (!asset) return void res.status(404).json({ error: "not_built", message: "\u0421\u0431\u043E\u0440\u043A\u0430 \u0434\u043B\u044F \u044D\u0442\u043E\u0439 \u0441\u0438\u0441\u0442\u0435\u043C\u044B \u0435\u0449\u0451 \u043D\u0435 \u043E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D\u0430." });
  const r = await fetch(asset.url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/octet-stream" }, redirect: "manual", signal: AbortSignal.timeout(1e4) });
  const loc = r.headers.get("location");
  if (!loc) return void res.status(502).json({ error: "download_failed", message: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0444\u0430\u0439\u043B. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435." });
  res.redirect(302, loc);
}));
appRouter.post("/verify", h2(async (req, res) => {
  if (!await rateLimit(`app-verify:${req.ip}`, 60, 10 * 6e4)) return void res.status(429).json({ ok: false, reason: "rate_limited" });
  const uid = parseKey(req.body?.key);
  if (!uid) return void res.json({ ok: false, reason: "invalid" });
  const user = await getUser(uid);
  if (!user) return void res.json({ ok: false, reason: "invalid" });
  if (!isSubscribed(user)) return void res.json({ ok: false, reason: "expired" });
  res.json({ ok: true, until: user.subscriptionUntil, name: user.firstName });
}));
appRouter.post("/parse-start", h2(async (req, res) => {
  if (!await rateLimit(`app-parse-ip:${req.ip}`, 60, 10 * 6e4)) {
    return void res.status(429).json({ ok: false, error: "rate_limited", message: "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u0447\u0430\u0441\u0442\u043E. \u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435." });
  }
  const uid = parseKey(req.body?.key);
  const user = uid ? await getUser(uid) : null;
  if (!user) return void res.status(401).json({ ok: false, error: "invalid", message: "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043A\u043B\u044E\u0447 \u043B\u0438\u0446\u0435\u043D\u0437\u0438\u0438." });
  if (!isSubscribed(user)) return void res.status(402).json({ ok: false, error: "expired", message: "\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 \u0437\u0430\u043A\u043E\u043D\u0447\u0438\u043B\u0430\u0441\u044C." });
  if (!await rateLimit(`maps-cooldown:${user.id}`, 1, 6 * 60 * 6e4)) {
    return void res.status(429).json({
      ok: false,
      error: "cooldown",
      message: "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u043F\u0430\u0440\u0441\u0438\u043D\u0433 \u0431\u0443\u0434\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0447\u0435\u0440\u0435\u0437 6 \u0447\u0430\u0441\u043E\u0432 \u043F\u043E\u0441\u043B\u0435 \u043F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0435\u0433\u043E \u0437\u0430\u043F\u0443\u0441\u043A\u0430."
    });
  }
  res.json({ ok: true });
}));
appRouter.post("/tg-search", h2(async (req, res) => {
  if (!await rateLimit(`app-tg-ip:${req.ip}`, 60, 10 * 6e4)) return void res.status(429).json({ ok: false, error: "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u0447\u0430\u0441\u0442\u043E. \u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435." });
  const uid = parseKey(req.body?.key);
  const user = uid ? await getUser(uid) : null;
  if (!user) return void res.status(401).json({ ok: false, reason: "invalid", error: "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043A\u043B\u044E\u0447 \u043B\u0438\u0446\u0435\u043D\u0437\u0438\u0438" });
  if (!isSubscribed(user)) return void res.status(402).json({ ok: false, reason: "expired", error: "\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 \u0437\u0430\u043A\u043E\u043D\u0447\u0438\u043B\u0430\u0441\u044C" });
  if (!await rateLimit(`app-tg-user:${user.id}`, 20, 10 * 6e4)) return void res.status(429).json({ ok: false, error: "\u041B\u0438\u043C\u0438\u0442: 20 \u043F\u043E\u0438\u0441\u043A\u043E\u0432 \u0437\u0430 10 \u043C\u0438\u043D\u0443\u0442" });
  const phrase = cleanText(req.body?.phrase, 120);
  const days = Math.min(3, Math.max(1, Math.round(Number(req.body?.days) || 3)));
  if (phrase.length < 3) return void res.status(400).json({ ok: false, error: "\u041E\u043F\u0438\u0448\u0438\u0442\u0435, \u0447\u0442\u043E \u0438\u0449\u0443\u0442: \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440, \xAB\u043D\u0443\u0436\u0435\u043D \u0441\u0430\u0439\u0442\xBB" });
  try {
    const r = await searchTg(phrase, days, true);
    res.json({ ok: true, rows: r.rows ?? [], stats: r.stats });
  } catch (e) {
    console.error("[app tg-search]", e);
    res.status(502).json({ ok: false, error: e?.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u0430" });
  }
}));

// server/routes.ts
import crypto6 from "node:crypto";
import { Router as Router3 } from "express";

// server/payments.ts
var YK = "https://api.yookassa.ru/v3/payments";
var ykAuth = () => "Basic " + Buffer.from(`${config.yookassaShopId}:${config.yookassaSecret}`).toString("base64");
async function activate(p) {
  const [user, plans] = await Promise.all([getUser(p.userId), getPlans()]);
  const plan = plans.find((x) => x.id === p.planId);
  if (!user || !plan) return;
  if (!await claimPayment(p.id)) return;
  try {
    const updated = await extendSubscription(user.id, plan.days);
    await notify(user.tgId, `\u2705 \u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 \u0430\u043A\u0442\u0438\u0432\u043D\u0430 \u0434\u043E ${new Date(updated.subscriptionUntil).toLocaleDateString("ru-RU")}. \u0414\u0430\u043D\u043D\u044B\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u044B \u0432 \u043A\u0430\u0431\u0438\u043D\u0435\u0442\u0435: ${config.appUrl}/app`);
  } catch (e) {
    await revertPayment(p.id);
    throw e;
  }
}
async function createPayment(user, planId) {
  const plans = await getPlans();
  const plan = plans.find((p) => p.id === planId);
  if (!plan) throw Object.assign(new Error("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0439 \u0442\u0430\u0440\u0438\u0444"), { status: 400 });
  const rec = {
    id: newId(),
    userId: user.id,
    planId: plan.id,
    amountRub: plan.priceRub,
    status: "pending",
    provider: config.paymentProvider,
    providerId: null,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    paidAt: null
  };
  await insertPayment(rec);
  if (config.paymentProvider === "yookassa") {
    if (!config.yookassaShopId || !config.yookassaSecret) throw new Error("\u042EKassa \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u0430");
    const resp = await fetch(YK, {
      method: "POST",
      headers: { Authorization: ykAuth(), "Idempotence-Key": rec.id, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: { value: plan.priceRub.toFixed(2), currency: "RUB" },
        capture: true,
        confirmation: { type: "redirect", return_url: `${config.appUrl}/app?paid=1` },
        description: `\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 Fracs: ${plan.title}`,
        metadata: { paymentId: rec.id }
      }),
      signal: AbortSignal.timeout(15e3)
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(`\u042EKassa: ${json?.description || resp.status}`);
    await setPaymentProviderId(rec.id, json.id);
    return { confirmationUrl: json.confirmation?.confirmation_url };
  }
  if (!config.allowMockPayments) throw Object.assign(new Error("\u041E\u043F\u043B\u0430\u0442\u0430 \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u0430"), { status: 503 });
  await activate(rec);
  return { activated: true };
}
async function handleYookassaWebhook(body) {
  const id = body?.object?.id;
  if (typeof id !== "string") return;
  const rec = await findPaymentByProviderId(id);
  if (!rec || rec.status !== "pending") return;
  const resp = await fetch(`${YK}/${encodeURIComponent(id)}`, { headers: { Authorization: ykAuth() }, signal: AbortSignal.timeout(15e3) });
  if (!resp.ok) return;
  const real = await resp.json();
  if (real.status === "canceled") {
    await cancelPayment(rec.id);
  } else if (real.status === "succeeded" && Number(real.amount?.value) === rec.amountRub && real.metadata?.paymentId === rec.id) {
    await activate(rec);
  }
}

// server/cron.ts
async function cronHandler(req, res) {
  const got = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!config.cronSecret || !safeEqual(got, config.cronSecret)) return void res.status(401).json({ error: "unauthorized" });
  await cleanup(config.searchRetentionDays);
  let reminded = 0;
  for (const u of await usersToRemind()) {
    const left = Math.max(1, Math.ceil((Date.parse(u.subscriptionUntil) - Date.now()) / 864e5));
    await notify(u.tgId, `\u23F3 \u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 Fracs \u0437\u0430\u043A\u043E\u043D\u0447\u0438\u0442\u0441\u044F \u0447\u0435\u0440\u0435\u0437 ${left} \u0434\u043D. (${new Date(u.subscriptionUntil).toLocaleDateString("ru-RU")}). \u041F\u0440\u043E\u0434\u043B\u0438\u0442\u044C: ${config.appUrl}/app`);
    await markReminded(u.id, u.subscriptionUntil);
    reminded++;
  }
  res.json({ ok: true, reminded });
}

// server/routes.ts
var api = Router3();
var h3 = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
api.use("/auth", authRouter);
api.get("/health", h3(async (_req, res) => {
  res.json({ ok: true, db: await ping().catch(() => false) });
}));
api.get("/config", h3(async (_req, res) => {
  res.json({
    devLogin: config.devLogin,
    payment: config.paymentProvider,
    plans: await getPlans(),
    demo: { maps: false, tg: false },
    adminUsername: config.adminUsername || void 0
  });
}));
api.get("/cities", (req, res) => {
  res.json({ items: searchCities(String(req.query.q || ""), 8) });
});
api.post("/payments/yookassa/webhook", h3(async (req, res) => {
  if (config.paymentProvider === "yookassa") {
    try {
      await handleYookassaWebhook(req.body);
    } catch (e) {
      console.error("[yookassa]", e);
      return void res.sendStatus(500);
    }
  }
  res.sendStatus(200);
}));
api.all("/cron/cleanup", h3(cronHandler));
var usedToday = (u) => countSearchesSince(u.id, 864e5);
api.get("/me", h3(async (req, res) => {
  const u = req.user;
  if (!u) return void res.json({ user: null });
  const [mapsTrialUsed, tgTrialUsed] = await Promise.all([
    hasUsedTrial(u.id, "maps"),
    hasUsedTrial(u.id, "tg")
  ]);
  res.json({
    user: { id: u.id, firstName: u.firstName, username: u.username },
    admin: config.adminTgId > 0 && u.tgId === config.adminTgId,
    subscription: { active: isSubscribed(u), until: u.subscriptionUntil },
    trial: { maps: !mapsTrialUsed, tg: !tgTrialUsed },
    quota: { used: await usedToday(u), limit: config.dailySearchLimit }
  });
}));
var MASK = "\u2022\u2022\u2022";
var MAPS_DOMAINS = /* @__PURE__ */ new Set(["ru", "kz", "by", "az", "kg", "uz", "cz", "eg", "it", "sa", "com.cy", "ae", "cl", "qa", "om", "bh", "kw", "iq"]);
var maskPhone = (p) => p ? p.slice(0, 7) + "\u2022\u2022\u2022-\u2022\u2022-" + p.slice(-2) : null;
var maskStart = (s, keep = 3) => s.slice(0, keep) + MASK;
var parseCooldownMs = 6 * 60 * 6e4;
function signTrialTicket(ticket) {
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  const signature = crypto6.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
function verifyTrialTicket(value, userId) {
  if (typeof value !== "string") return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = value.slice(0, separator);
  const supplied = Buffer.from(value.slice(separator + 1));
  const expected = Buffer.from(crypto6.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url"));
  if (supplied.length !== expected.length || !crypto6.timingSafeEqual(supplied, expected)) return null;
  try {
    const ticket = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (ticket.userId !== userId || !ticket.jobId || !ticket.seed || Date.now() - ticket.createdAt > 3 * 60 * 6e4) return null;
    return ticket;
  } catch {
    return null;
  }
}
function parse2gisUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const domain = parsed.hostname.startsWith("2gis.") ? parsed.hostname.slice("2gis.".length) : "";
    if (!MAPS_DOMAINS.has(domain) || parts.length < 3 || parts[1] !== "search") return null;
    return {
      url: parsed.toString(),
      cityKey: `${parsed.hostname.toLowerCase()}:${parts[0].toLowerCase()}`,
      city: decodeURIComponent(parts[0]),
      niche: decodeURIComponent(parts[2]).trim()
    };
  } catch {
    return null;
  }
}
function teaser(rec) {
  const rows = headRows(rec);
  if (rec.kind === "maps") {
    return rows.map((r) => ({
      id: r.id,
      name: maskStart(r.name, 6),
      category: r.category,
      address: r.address.split(",")[0] + ", " + MASK,
      phone: maskPhone(r.phone),
      rating: r.rating,
      reviews: r.reviews,
      url: null
    }));
  }
  return rows.map((r) => ({
    id: r.id,
    username: maskStart(r.username, 2),
    name: r.name[0] + MASK,
    chat: maskStart(r.chat, 4),
    text: maskStart(r.text, 20),
    date: r.date,
    link: ""
  }));
}
var view = (rec, u) => ({
  id: rec.id,
  kind: rec.kind,
  createdAt: rec.createdAt,
  demo: rec.demo,
  query: rec.query,
  stats: rec.stats,
  rowsTotal: rec.rowsTotal,
  teaser: isSubscribed(u) ? [] : teaser(rec)
});
async function fullTrialView(rec, user) {
  const stored = await getSearch(rec.id, user.id, true);
  return {
    ...view(rec, user),
    trialRows: stored ? getRows(stored, 0, stored.rowsTotal) : []
  };
}
async function gate(req, res) {
  if (!await rateLimit(`search:${req.user.id}`, 10, 6e4)) {
    res.status(429).json({ error: "rate_limited", message: "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u0447\u0430\u0441\u0442\u043E. \u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435 \u043C\u0438\u043D\u0443\u0442\u0443." });
    return false;
  }
  if (await usedToday(req.user) >= config.dailySearchLimit) {
    res.status(429).json({ error: "quota", message: `\u0414\u043D\u0435\u0432\u043D\u043E\u0439 \u043B\u0438\u043C\u0438\u0442 ${config.dailySearchLimit} \u0437\u0430\u043F\u0440\u043E\u0441\u043E\u0432 \u0438\u0441\u0447\u0435\u0440\u043F\u0430\u043D.` });
    return false;
  }
  return true;
}
async function findRecent(u, kind, match) {
  return (await recentSearches(u.id, kind, 864e5)).find((r) => match(r) && !r.demo && r.rowsTotal > 0);
}
api.post("/search/maps", requireAuth, h3(async (req, res) => {
  const niche = cleanText(req.body?.niche, 80);
  const city = findCity(String(req.body?.cityId || ""));
  if (niche.length < 2) return void res.status(400).json({ error: "bad_niche", message: "\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u043D\u0438\u0448\u0443 \u2014 \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440, \xAB\u0430\u0432\u0442\u043E\u0441\u0435\u0440\u0432\u0438\u0441\xBB." });
  if (!city) return void res.status(400).json({ error: "bad_city", message: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0433\u043E\u0440\u043E\u0434 \u0438\u0437 \u0441\u043F\u0438\u0441\u043A\u0430." });
  const again = await findRecent(req.user, "maps", (s) => s.query.cityId === city.id && norm(s.query.niche || "") === norm(niche));
  if (again) return void res.json(view(again, req.user));
  if (!await gate(req, res)) return;
  const subscribed = isSubscribed(req.user);
  if (!subscribed && await hasUsedTrial(req.user.id, "maps")) return void trialUsed(res);
  if (subscribed && !await rateLimit(`maps-cooldown:${req.user.id}`, 1, parseCooldownMs)) {
    return void res.status(429).json({ error: "cooldown", message: "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u043F\u0430\u0440\u0441\u0438\u043D\u0433 \u0431\u0443\u0434\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0447\u0435\u0440\u0435\u0437 6 \u0447\u0430\u0441\u043E\u0432 \u043F\u043E\u0441\u043B\u0435 \u043F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0435\u0433\u043E \u0437\u0430\u043F\u0443\u0441\u043A\u0430." });
  }
  try {
    const result = await searchMaps(niche, city, true);
    const stats = { ...result.stats };
    const summary = summarize("maps", stats, result.rows);
    const rec = {
      id: newId(),
      userId: req.user.id,
      kind: "maps",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      demo: false,
      seed: `${norm(niche)}|${city.id}`,
      query: { niche, cityId: city.id, cityLabel: `${city.name}, ${city.region}` },
      stats,
      rows: result.rows,
      ...summary
    };
    if (!subscribed && rec.rowsTotal > 0 && !await claimTrial(req.user.id, "maps")) return void trialUsed(res);
    await insertSearch(rec);
    res.json(view(rec, req.user));
  } catch (e) {
    console.error("[maps]", e);
    res.status(502).json({ error: "provider", message: `\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435: ${e?.message || "\u043E\u0448\u0438\u0431\u043A\u0430 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u0430"}` });
  }
}));
api.post("/search/maps/trial/start", requireAuth, h3(async (req, res) => {
  const user = req.user;
  const isAdmin = config.adminTgId > 0 && user.tgId === config.adminTgId;
  if (isSubscribed(user) && !isAdmin) return void res.status(403).json({ error: "subscription_active", message: "\u041F\u0440\u043E\u0431\u043D\u044B\u0439 \u0437\u0430\u043F\u0443\u0441\u043A \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0442\u043E\u043B\u044C\u043A\u043E \u0431\u0435\u0437 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0439 \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0438." });
  if (await hasUsedTrial(user.id, "maps")) return void trialUsed(res);
  if (!await gate(req, res)) return;
  if (!config.mapsWorkerUrl || !config.mapsWorkerToken) {
    return void res.status(503).json({ error: "worker_unconfigured", message: "\u0420\u0435\u0430\u043B\u044C\u043D\u044B\u0439 \u043F\u0440\u043E\u0431\u043D\u044B\u0439 \u043F\u0430\u0440\u0441\u0438\u043D\u0433 \u043F\u043E\u043A\u0430 \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D. \u0410\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0443 \u043D\u0443\u0436\u043D\u043E \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u044C Chrome-worker." });
  }
  const suppliedUrls = Array.isArray(req.body?.urls) ? req.body.urls : [];
  const searches = suppliedUrls.map(parse2gisUrl);
  if (!searches.length || searches.some((search) => !search)) {
    return void res.status(400).json({ error: "bad_urls", message: "\u0414\u043E\u0431\u0430\u0432\u044C\u0442\u0435 \u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0435 \u0441\u0441\u044B\u043B\u043A\u0438 \u043F\u043E\u0438\u0441\u043A\u0430 2\u0413\u0418\u0421." });
  }
  const parsed = searches.filter((search) => search !== null);
  if (parsed.length > 30) return void res.status(400).json({ error: "too_many_urls", message: "\u0417\u0430 \u043E\u0434\u0438\u043D \u043F\u0440\u043E\u0431\u043D\u044B\u0439 \u0437\u0430\u043F\u0443\u0441\u043A \u043C\u043E\u0436\u043D\u043E \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u043D\u0435 \u0431\u043E\u043B\u0435\u0435 30 \u0441\u0441\u044B\u043B\u043E\u043A." });
  if (new Set(parsed.map((search) => search.cityKey)).size > 3) {
    return void res.status(400).json({ error: "city_limit", message: "\u0417\u0430 \u043E\u0434\u0438\u043D \u0437\u0430\u043F\u0443\u0441\u043A \u043C\u043E\u0436\u043D\u043E \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u043D\u0435 \u0431\u043E\u043B\u0435\u0435 3 \u0433\u043E\u0440\u043E\u0434\u043E\u0432." });
  }
  const uniqueUrls = [...new Set(parsed.map((search) => search.url))];
  const niche = cleanText(parsed[0].niche, 80) || "\u041F\u043E\u0438\u0441\u043A 2\u0413\u0418\u0421";
  const cityLabel = [...new Set(parsed.map((search) => search.city))].join(", ");
  const seed = crypto6.createHash("sha256").update([...uniqueUrls].sort().join("\n")).digest("hex");
  try {
    const workerResponse = await fetch(`${config.mapsWorkerUrl}/api/internal/trial/jobs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.mapsWorkerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        urls: uniqueUrls,
        max_records: Math.min(60, Math.max(1, Number(req.body?.maxRecords) || 20)),
        clean: true,
        filters: {
          ...req.body?.filters || {},
          require_website: false,
          require_no_website: true
        },
        advanced: req.body?.advanced || {},
        directions: uniqueUrls.map((url) => ({ url, label: String(req.body?.labels?.[url] || "") }))
      }),
      signal: AbortSignal.timeout(1e4)
    });
    const workerResult = await workerResponse.json().catch(() => ({}));
    if (!workerResponse.ok) {
      return void res.status(workerResponse.status === 409 ? 409 : 502).json({
        error: "worker_start_failed",
        message: workerResult.error || "Chrome-worker \u043D\u0435 \u0441\u043C\u043E\u0433 \u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u0437\u0430\u0434\u0430\u0447\u0443."
      });
    }
    if (typeof workerResult.jobId !== "string" || !workerResult.jobId) {
      return void res.status(502).json({ error: "worker_bad_response", message: "Chrome-worker \u0432\u0435\u0440\u043D\u0443\u043B \u043D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 \u043E\u0442\u0432\u0435\u0442." });
    }
    const ticket = signTrialTicket({ userId: user.id, jobId: workerResult.jobId, seed, niche, cityLabel, createdAt: Date.now() });
    res.json({ ticket, status: "running" });
  } catch (e) {
    console.error("[maps worker start]", e);
    res.status(502).json({ error: "worker_unreachable", message: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u044C\u0441\u044F \u043A Chrome-worker. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435." });
  }
}));
api.post("/search/maps/trial/status", requireAuth, h3(async (req, res) => {
  const ticket = verifyTrialTicket(req.body?.ticket, req.user.id);
  if (!ticket) return void res.status(400).json({ error: "bad_ticket", message: "\u0417\u0430\u0434\u0430\u043D\u0438\u0435 \u043D\u0435\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0442\u0435\u043B\u044C\u043D\u043E \u0438\u043B\u0438 \u0443\u0441\u0442\u0430\u0440\u0435\u043B\u043E. \u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0435 \u043F\u0440\u043E\u0431\u043D\u044B\u0439 \u043F\u043E\u0438\u0441\u043A \u0437\u0430\u043D\u043E\u0432\u043E." });
  const existing = (await recentSearches(req.user.id, "maps", 3 * 60 * 6e4)).find((record) => record.seed === ticket.seed && !record.demo && record.rowsTotal > 0);
  if (existing) return void res.json({ status: "done", result: await fullTrialView(existing, req.user) });
  if (!config.mapsWorkerUrl || !config.mapsWorkerToken) {
    return void res.status(503).json({ error: "worker_unconfigured", message: "Chrome-worker \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D." });
  }
  try {
    const workerResponse = await fetch(`${config.mapsWorkerUrl}/api/internal/trial/jobs/${encodeURIComponent(ticket.jobId)}`, {
      headers: { Authorization: `Bearer ${config.mapsWorkerToken}` },
      signal: AbortSignal.timeout(1e4)
    });
    const workerResult = await workerResponse.json().catch(() => ({}));
    if (!workerResponse.ok) {
      return void res.status(workerResponse.status === 404 ? 404 : 502).json({
        error: "worker_status_failed",
        message: workerResult.error || "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 Chrome-worker."
      });
    }
    if (workerResult.status === "running") {
      return void res.json({ status: "running", count: Number(workerResult.count) || 0, logs: workerResult.logs || [] });
    }
    if (workerResult.status === "error") {
      return void res.json({ status: "error", error: workerResult.error || "Chrome-\u043F\u0430\u0440\u0441\u0435\u0440 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u043B\u0441\u044F \u0441 \u043E\u0448\u0438\u0431\u043A\u043E\u0439.", logs: workerResult.logs || [] });
    }
    if (!["done", "stopped"].includes(workerResult.status) || !Array.isArray(workerResult.records)) {
      return void res.status(502).json({ error: "worker_bad_response", message: "Chrome-worker \u0432\u0435\u0440\u043D\u0443\u043B \u043D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442." });
    }
    const rows = workerResult.records.map((record, index) => {
      const contacts = record?.contacts && typeof record.contacts === "object" ? record.contacts : {};
      const phoneValue = contacts.phone || record.phone;
      const ratingValue = record.rating == null || record.rating === "" ? null : Number(record.rating);
      const reviewsValue = record.review_count == null || record.review_count === "" ? null : Number(record.review_count);
      return {
        id: String(record.id || `${ticket.jobId}-${index}`),
        name: cleanText(record.name, 200) || "\u0411\u0435\u0437 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044F",
        category: cleanText(Array.isArray(record.rubrics) ? record.rubrics.join(", ") : "", 160) || ticket.niche,
        address: cleanText([record.address, record.district, record.city].filter(Boolean).join(", "), 300),
        phone: typeof phoneValue === "string" && phoneValue ? cleanText(phoneValue, 80) : null,
        rating: ratingValue !== null && Number.isFinite(ratingValue) ? ratingValue : null,
        reviews: reviewsValue !== null && Number.isFinite(reviewsValue) ? reviewsValue : null,
        url: typeof record.url === "string" ? record.url : null
      };
    });
    if (!rows.length) {
      return void res.json({ status: "done", empty: true, logs: workerResult.logs || [] });
    }
    const stats = {
      total: rows.length,
      withoutSite: rows.length,
      withPhone: rows.filter((row) => Boolean(row.phone)).length
    };
    const summary = summarize("maps", stats, rows);
    const rec = {
      id: newId(),
      userId: req.user.id,
      kind: "maps",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      demo: false,
      seed: ticket.seed,
      query: { niche: ticket.niche, cityLabel: ticket.cityLabel },
      stats,
      rows,
      ...summary
    };
    if (!await claimTrial(req.user.id, "maps")) {
      const used = (await recentSearches(req.user.id, "maps", 3 * 60 * 6e4)).find((record) => record.seed === ticket.seed && !record.demo && record.rowsTotal > 0);
      if (used) return void res.json({ status: "done", result: await fullTrialView(used, req.user) });
      return void trialUsed(res);
    }
    await insertSearch(rec);
    res.json({ status: "done", result: { ...view(rec, req.user), trialRows: rows } });
  } catch (e) {
    console.error("[maps worker status]", e);
    res.status(502).json({ error: "worker_unreachable", message: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u044B Chrome-\u043F\u0430\u0440\u0441\u0438\u043D\u0433\u0430." });
  }
}));
api.post("/search/tg", requireAuth, h3(async (req, res) => {
  const phrase = cleanText(req.body?.phrase, 120);
  const days = Math.min(3, Math.max(1, Math.round(Number(req.body?.days) || 3)));
  if (phrase.length < 3) return void res.status(400).json({ error: "bad_phrase", message: "\u041E\u043F\u0438\u0448\u0438\u0442\u0435, \u043A\u043E\u043C\u0443 \u0438 \u0447\u0442\u043E \u043D\u0443\u0436\u043D\u043E \u2014 \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440, \xAB\u043D\u0443\u0436\u0435\u043D \u0441\u0430\u0439\u0442\xBB." });
  const again = await findRecent(req.user, "tg", (s) => norm(s.query.phrase || "") === norm(phrase) && s.query.days === days);
  if (again) return void res.json(view(again, req.user));
  if (!await gate(req, res)) return;
  const subscribed = isSubscribed(req.user);
  if (!subscribed && await hasUsedTrial(req.user.id, "tg")) return void trialUsed(res);
  try {
    const result = await searchTg(phrase, days, true);
    const stats = { ...result.stats };
    const summary = summarize("tg", stats, result.rows);
    const rec = {
      id: newId(),
      userId: req.user.id,
      kind: "tg",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      demo: false,
      seed: `${norm(phrase)}|${days}`,
      query: { phrase, days },
      stats,
      rows: result.rows,
      ...summary
    };
    if (!subscribed && rec.rowsTotal > 0 && !await claimTrial(req.user.id, "tg")) return void trialUsed(res);
    await insertSearch(rec);
    res.json(view(rec, req.user));
  } catch (e) {
    console.error("[tg]", e);
    res.status(502).json({ error: "provider", message: `\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435: ${e?.message || "\u043E\u0448\u0438\u0431\u043A\u0430 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u0430"}` });
  }
}));
api.get("/searches", requireAuth, h3(async (req, res) => {
  const kind = req.query.kind === "tg" ? "tg" : "maps";
  const items = (await listSearches(req.user.id, kind, 10)).map((s) => view(s, req.user));
  res.json({ items });
}));
var needSub2 = (res) => res.status(402).json({ error: "subscription_required", message: "\u0414\u0430\u043D\u043D\u044B\u0435 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B \u043F\u043E \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0435." });
var trialUsed = (res) => res.status(402).json({ error: "trial_used", message: "\u041F\u0440\u043E\u0431\u043D\u044B\u0439 \u043F\u043E\u0438\u0441\u043A \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D. \u041E\u0444\u043E\u0440\u043C\u0438\u0442\u0435 \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0443 \u0434\u043B\u044F \u043D\u043E\u0432\u043E\u0433\u043E \u043F\u043E\u0438\u0441\u043A\u0430." });
api.get("/search/:id", requireAuth, h3(async (req, res) => {
  const rec = await getSearch(String(req.params.id), req.user.id);
  if (!rec) return void res.status(404).json({ error: "not_found" });
  res.json(view(rec, req.user));
}));
api.get("/search/:id/rows", requireAuth, h3(async (req, res) => {
  if (!isSubscribed(req.user)) {
    const exists = await getSearch(String(req.params.id), req.user.id);
    return void (exists ? needSub2(res) : res.status(404).json({ error: "not_found" }));
  }
  const rec = await getSearch(String(req.params.id), req.user.id, true);
  if (!rec) return void res.status(404).json({ error: "not_found" });
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  res.json({ rows: getRows(rec, offset, limit), total: rec.rowsTotal });
}));
var csvCell = (v) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};
api.get("/search/:id/export.csv", requireAuth, h3(async (req, res) => {
  if (!isSubscribed(req.user)) {
    const exists = await getSearch(String(req.params.id), req.user.id);
    return void (exists ? needSub2(res) : res.status(404).json({ error: "not_found" }));
  }
  const rec = await getSearch(String(req.params.id), req.user.id, true);
  if (!rec) return void res.status(404).json({ error: "not_found" });
  const rows = getRows(rec, 0, rec.rowsTotal);
  const cols = rec.kind === "maps" ? [["\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435", (r) => r.name], ["\u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F", (r) => r.category], ["\u0410\u0434\u0440\u0435\u0441", (r) => r.address], ["\u0422\u0435\u043B\u0435\u0444\u043E\u043D", (r) => r.phone], ["\u0420\u0435\u0439\u0442\u0438\u043D\u0433", (r) => r.rating], ["\u041E\u0442\u0437\u044B\u0432\u043E\u0432", (r) => r.reviews], ["\u0421\u0441\u044B\u043B\u043A\u0430", (r) => r.url]] : [["Username", (r) => r.username], ["\u0418\u043C\u044F", (r) => r.name], ["\u0427\u0430\u0442", (r) => r.chat], ["\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435", (r) => r.text], ["\u0414\u0430\u0442\u0430", (r) => r.date], ["\u0421\u0441\u044B\u043B\u043A\u0430", (r) => r.link]];
  const csv = "\uFEFF" + [cols.map((c) => csvCell(c[0])).join(";"), ...rows.map((r) => cols.map((c) => csvCell(c[1](r))).join(";"))].join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="fracs-${rec.kind}-${rec.id.slice(0, 8)}.csv"`);
  res.send(csv);
}));
api.post("/payments/request", requireAuth, h3(async (req, res) => {
  if (!await rateLimit(`payreq:${req.user.id}`, 5, 10 * 6e4)) return void res.status(429).json({ error: "rate_limited", message: "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u0447\u0430\u0441\u0442\u043E. \u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435 \u043D\u0435\u043C\u043D\u043E\u0433\u043E." });
  const plans = await getPlans();
  const plan = plans.find((p) => p.id === String(req.body?.planId || ""));
  if (!plan) return void res.status(400).json({ error: "bad_plan", message: "\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0439 \u0442\u0430\u0440\u0438\u0444" });
  const u = req.user;
  if (config.adminTgId > 0) {
    await notify(
      config.adminTgId,
      `\u{1F9FE} \u0417\u0430\u044F\u0432\u043A\u0430 \u043D\u0430 \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0443
${u.username ? "@" + u.username : u.firstName} (id ${u.tgId})
\u0422\u0430\u0440\u0438\u0444: ${plan.title}, ${plan.priceRub} \u20BD

\u0412\u044B\u0434\u0430\u0442\u044C: /grant ${u.tgId} ${plan.days}`
    );
  }
  res.json({ ok: true });
}));
api.post("/payments/create", requireAuth, h3(async (req, res) => {
  if (!await rateLimit(`pay:${req.user.id}`, 10, 10 * 6e4)) return void res.status(429).json({ error: "rate_limited" });
  try {
    res.json(await createPayment(req.user, String(req.body?.planId || "")));
  } catch (e) {
    console.error("[pay]", e);
    res.status(e.status || 502).json({ error: "payment", message: e.status ? e.message : "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0437\u0434\u0430\u0442\u044C \u043F\u043B\u0430\u0442\u0451\u0436. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435." });
  }
}));

// server/app.ts
function buildApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });
  app.use((req, _res, next) => {
    try {
      const b = req.body;
      if (b !== void 0 && b !== null && typeof b === "object" && !Buffer.isBuffer(b)) req._body = true;
      next();
    } catch (e) {
      next(Object.assign(e, { type: "entity.parse.failed" }));
    }
  });
  app.use(express.json({ limit: "100kb" }));
  app.post("/api/bot/webhook", webhookHandler);
  app.use("/api/app", attachUser, appRouter);
  app.use("/api", attachUser, api);
  app.use("/api", (_req, res) => res.status(404).json({ error: "not_found" }));
  app.use((err, _req, res, _next) => {
    if (err?.type === "entity.parse.failed") return void res.status(400).json({ error: "bad_json" });
    console.error(err);
    res.status(500).json({ error: "server_error" });
  });
  return app;
}

// server/vercel.ts
var vercel_default = buildApp();
export {
  vercel_default as default
};
