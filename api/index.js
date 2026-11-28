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
var rawVercelHost = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL || "";
var vercelUrl = rawVercelHost ? `https://${rawVercelHost.replace(/^https?:\/\//, "")}` : "";
var cleanToken = (v) => (v || "").trim().replace(/^["']|["']$/g, "");
var config = {
  isProd,
  port,
  appUrl: (cleanToken(env.APP_URL) || vercelUrl || `http://localhost:${port}`).replace(/\/$/, ""),
  sessionSecret: env.SESSION_SECRET || (isProd ? crypto.randomBytes(32).toString("hex") : "dev-secret-change-me"),
  supabaseUrl: cleanToken(env.SUPABASE_URL).replace(/\/$/, ""),
  supabaseKey: cleanToken(env.SUPABASE_SERVICE_ROLE_KEY),
  cronSecret: cleanToken(env.CRON_SECRET),
  searchRetentionDays: Number(env.SEARCH_RETENTION_DAYS || 30),
  // Почта для OTP-кодов (Resend API, опционально)
  resendApiKey: cleanToken(env.RESEND_API_KEY),
  resendFrom: env.RESEND_FROM || "Fracs <onboarding@resend.dev>",
  // Ключи провайдеров прокси Fracs AI (/api/app/ai): хранятся ТОЛЬКО на сервере,
  // в сборку программы не попадают. Пользовательский запрос идёт с ключом лицензии.
  ollamaApiKey: cleanToken(env.OLLAMA_API_KEY),
  ollamaUrl: (cleanToken(env.OLLAMA_URL) || "https://ollama.com/v1").replace(/\/$/, ""),
  fracsAiBackend: ["ollama", "openrouter"].includes(cleanToken(env.FRACS_AI_BACKEND).toLowerCase()) ? cleanToken(env.FRACS_AI_BACKEND).toLowerCase() : "auto",
  openrouterApiKey: cleanToken(env.OPENROUTER_API_KEY),
  openrouterUrl: "https://openrouter.ai/api/v1",
  // Cohere (Command A) работает ВМЕСТЕ с OpenRouter внутри Fracs AI: пишет тексты/арт-дирекшн и
  // вычитывает готовый сайт, а вёрстку собирает основная модель. Ключ — только на сервере.
  cohereApiKey: cleanToken(env.COHERE_API_KEY),
  cohereUrl: "https://api.cohere.ai/compatibility/v1",
  // Qwen (Alibaba Cloud Model Studio, OpenAI-совместимый режим) — ещё один запасной движок Fracs AI.
  // QWEN_BASE_URL — адрес вашего рабочего пространства (openAiCompatible из консоли Model Studio).
  qwenApiKey: cleanToken(env.QWEN_API_KEY),
  qwenUrl: (cleanToken(env.QWEN_BASE_URL) || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1").replace(/\/$/, ""),
  qwenModel: cleanToken(env.QWEN_MODEL) || "qwen-plus-character",
  botToken: cleanToken(env.TELEGRAM_BOT_TOKEN),
  botUsername: cleanToken(env.TELEGRAM_BOT_USERNAME).replace(/^@/, ""),
  // На Vercel работает только webhook. polling — для локальной разработки.
  botMode: env.TELEGRAM_BOT_MODE === "webhook" ? "webhook" : "polling",
  webhookSecret: cleanToken(env.TELEGRAM_WEBHOOK_SECRET),
  mapsProvider: env.MAPS_PROVIDER || "mock",
  gisKey: cleanToken(env.GIS_API_KEY),
  mapsWorkerUrl: cleanToken(env.MAPS_WORKER_URL).replace(/\/$/, ""),
  mapsWorkerToken: cleanToken(env.MAPS_WORKER_TOKEN),
  tgProvider: env.TG_PROVIDER || "mock",
  tgParserUrl: cleanToken(env.TG_PARSER_URL).replace(/\/$/, ""),
  tgParserKey: cleanToken(env.TG_PARSER_KEY),
  paymentProvider: env.PAYMENT_PROVIDER === "xrocket" ? "xrocket" : "cryptobot",
  cryptobotToken: cleanToken(env.CRYPTOBOT_API_TOKEN),
  xrocketKey: cleanToken(env.XROCKET_API_KEY),
  xrocketWebhookToken: cleanToken(env.XROCKET_WEBHOOK_TOKEN),
  // 'legacy' (pay.xrocket.tg + Rocket-Pay-Key), 'pay' (pay.api.xrocket.exchange + Bearer) или 'auto' (по виду ключа).
  xrocketApi: ["legacy", "pay"].includes(cleanToken(env.XROCKET_API_VERSION)) ? cleanToken(env.XROCKET_API_VERSION) : "auto",
  usdtRubRate: Number(env.USDT_RUB_RATE || 95),
  supportUsername: (env.SUPPORT_TG_USERNAME || "HelpManage").replace(/^@/, ""),
  dailySearchLimit: Number(env.DAILY_SEARCH_LIMIT || 40),
  // Telegram ID админа (число, не @username): подписка ему не нужна, всё открыто.
  adminTgId: Number(env.ADMIN_TG_ID) || 0,
  // @username админа: уведомления о заявках.
  adminUsername: (env.ADMIN_TG_USERNAME || "").replace(/^@/, ""),
  // Обязательные подписки на каналы перед активацией кабинета. Список через запятую:
  // @username канала или его числовой ID (-100…). Бот должен быть админом в каждом канале,
  // иначе getChatMember не увидит статус. Проверяется при старте в боте и на каждом действии
  // в кабинете/программе; админ (ADMIN_TG_ID) проверку проходит всегда.
  requiredChannels: (env.REQUIRED_CHANNELS || "").split(",").map((s) => s.trim().replace(/^@/, "")).filter(Boolean)
};
if (isProd) {
  const missing = ["SESSION_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !env[k]);
  if (missing.length) console.warn(`[config] \u041F\u0435\u0440\u0435\u043C\u0435\u043D\u043D\u044B\u0435 \u043D\u0435 \u0437\u0430\u0434\u0430\u043D\u044B (\u0440\u0430\u0431\u043E\u0442\u0430\u0435\u043C \u0432 fallback-\u0440\u0435\u0436\u0438\u043C\u0435): ${missing.join(", ")}`);
  if (env.SESSION_SECRET && env.SESSION_SECRET.length < 32) console.warn("[config] SESSION_SECRET \u0440\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0443\u0435\u0442\u0441\u044F \u2265 32 \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432");
}
var PLANS = [
  {
    id: "start",
    title: "Start",
    days: 30,
    priceRub: 1800,
    features: ["base", "telegram", "cards"],
    description: "\u041F\u0430\u0440\u0441\u0438\u043D\u0433 Telegram \u0438 \u043A\u0430\u0440\u0442 2\u0413\u0418\u0421: \u0431\u0430\u0437\u0430 \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u043E\u0432 \u0438 \u0432\u044B\u0433\u0440\u0443\u0437\u043A\u0438 CSV/HTML \u043D\u0430 30 \u0434\u043D\u0435\u0439."
  },
  {
    id: "pro",
    title: "PRO",
    days: 30,
    priceRub: 2700,
    badge: "\u0412\u043B\u0430\u0434\u0435\u043B\u044C\u0446\u044B + \u041E\u0431\u0443\u0447\u0435\u043D\u0438\u0435",
    features: ["base", "telegram", "cards", "owners", "training", "ai_provider"],
    description: "\u0412\u0441\u0451 \u0438\u0437 \xABStart\xBB + \u043F\u043E\u0438\u0441\u043A \u0432\u043B\u0430\u0434\u0435\u043B\u044C\u0446\u0435\u0432 (\u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044C / \u0418\u041F, \u0418\u041D\u041D, \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u044B), \u0440\u0430\u0437\u0434\u0435\u043B \xAB\u041E\u0431\u0443\u0447\u0435\u043D\u0438\u0435\xBB \u0438 AI-\u0430\u0433\u0435\u043D\u0442 \u0441\u043E \u0441\u0432\u043E\u0438\u043C \u043F\u0440\u043E\u0432\u0430\u0439\u0434\u0435\u0440\u043E\u043C (\u0441\u0432\u043E\u0439 API-\u043A\u043B\u044E\u0447)."
  },
  {
    id: "ultra",
    title: "Ultra",
    days: 30,
    priceRub: 4500,
    badge: "\u041C\u0430\u043A\u0441\u0438\u043C\u0443\u043C",
    features: ["base", "telegram", "cards", "owners", "training", "ai_provider", "fracs_ai", "ai", "business", "tg_broadcast"],
    description: "\u0412\u0441\u0451 \u0438\u0437 \xABPRO\xBB + \u0432\u0441\u0442\u0440\u043E\u0435\u043D\u043D\u044B\u0439 Fracs AI (\u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F \u0441\u0430\u0439\u0442\u043E\u0432 \u0438 \u0444\u0440\u0430\u0437 \u043D\u0430 \u0432\u0441\u0442\u0440\u043E\u0435\u043D\u043D\u043E\u043C \u043A\u043B\u044E\u0447\u0435, \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u0430\u044F \u043A\u043D\u043E\u043F\u043A\u0430 \u0432 AI-\u0430\u0433\u0435\u043D\u0442\u0435). \u0420\u0430\u0441\u0441\u044B\u043B\u043A\u0430 \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u043A \u0438\u0437 \u043F\u0440\u0438\u0432\u044F\u0437\u0430\u043D\u043D\u044B\u0445 Telegram-\u0430\u043A\u043A\u0430\u0443\u043D\u0442\u043E\u0432. \u041C\u0430\u043A\u0441\u0438\u043C\u0443\u043C \u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E\u0441\u0442\u0435\u0439."
  }
];
var TOKEN_PACKS = [
  { id: "tokens_100k", title: "100 000 \u0442\u043E\u043A\u0435\u043D\u043E\u0432", tokens: 1e5, priceRub: 149, badge: "\u2248 3\u20134 \u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u0438 \u0441\u0430\u0439\u0442\u0430" },
  { id: "tokens_500k", title: "500 000 \u0442\u043E\u043A\u0435\u043D\u043E\u0432", tokens: 5e5, priceRub: 590, badge: "\u0412\u044B\u0433\u043E\u0434\u043D\u0435\u0435: \u2248 15\u201320 \u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u0439" },
  { id: "tokens_1m", title: "1 000 000 \u0442\u043E\u043A\u0435\u043D\u043E\u0432", tokens: 1e6, priceRub: 990, badge: "\u041C\u0430\u043A\u0441\u0438\u043C\u0443\u043C: \u2248 30\u201340 \u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u0439" }
];
function loadTokenPacks(fromDb) {
  try {
    if (Array.isArray(fromDb) && fromDb.length) {
      return fromDb.filter((p) => p && typeof p.id === "string" && p.tokens > 0 && p.priceRub > 0);
    }
    const raw = process.env.AI_TOKEN_PACKS;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed.filter((p) => p && typeof p.id === "string" && p.tokens > 0 && p.priceRub > 0);
    }
  } catch {
  }
  return TOKEN_PACKS;
}
var ALL_FEATURES = Array.from(new Set(PLANS.flatMap((p) => p.features ?? [])));

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
var memEmailUsers = /* @__PURE__ */ new Map();
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
  tgId: r.tg_id == null ? null : Number(r.tg_id),
  email: r.email ?? null,
  username: r.username,
  firstName: r.first_name,
  createdAt: r.created_at,
  subscriptionUntil: r.subscription_until,
  planId: r.plan_id ?? null
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
    email: null,
    username: from.username ?? null,
    firstName: from.first_name || "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C",
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    subscriptionUntil: null,
    planId: null
  };
  memUsers.set(id, newUser);
  memTgUsers.set(from.id, id);
  return withAdmin({ ...newUser });
}
async function upsertEmailUser(email) {
  if (useSupabase) {
    const existing = check(await sb().from("users").select("*").eq("email", email).maybeSingle(), "upsertEmailUser.find");
    if (existing) return userOf(existing);
    const r = await sb().from("users").insert({ tg_id: null, email, first_name: email.split("@")[0] || "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C" }).select("*").single();
    return userOf(check(r, "upsertEmailUser"));
  }
  const existingId = memEmailUsers.get(email);
  if (existingId && memUsers.has(existingId)) return withAdmin({ ...memUsers.get(existingId) });
  const id = newId();
  const newUser = {
    id,
    tgId: null,
    email,
    username: null,
    firstName: email.split("@")[0] || "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C",
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    subscriptionUntil: null,
    planId: null
  };
  memUsers.set(id, newUser);
  memEmailUsers.set(email, id);
  return withAdmin({ ...newUser });
}
var isSubscribed = (u) => !!u.subscriptionUntil && Date.parse(u.subscriptionUntil) > Date.now();
async function getActiveFeatures(u) {
  if (isAdminTg(u.tgId)) return [...ALL_FEATURES];
  if (!isSubscribed(u)) return [];
  if (!u.planId) return ["base"];
  const plans = await getPlans();
  const planId = u.planId === "month" || u.planId === "quarter" ? "start" : u.planId;
  const plan = plans.find((p) => p.id === planId);
  return plan?.features ?? ["base"];
}
async function extendSubscription(userId, days, planId) {
  const u = await getUser(userId);
  if (!u) throw new Error("user not found");
  if (isAdminTg(u.tgId)) return u;
  const base = isSubscribed(u) ? Date.parse(u.subscriptionUntil) : Date.now();
  const until = new Date(base + days * 864e5).toISOString();
  const nextPlanId = planId ?? u.planId ?? null;
  if (useSupabase) {
    const patch = { subscription_until: until };
    if (planId !== void 0) patch.plan_id = nextPlanId;
    const r = await sb().from("users").update(patch).eq("id", userId).select("*").single();
    return userOf(check(r, "extendSubscription"));
  }
  const updated = { ...u, subscriptionUntil: until, planId: nextPlanId };
  memUsers.set(userId, updated);
  return withAdmin({ ...updated });
}
async function findUser(q) {
  const s = q.trim().replace(/^@/, "");
  if (!s) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    return await getUser(s);
  }
  const byId = /^\d+$/.test(s);
  const byEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.toLowerCase());
  if (useSupabase) {
    const base = sb().from("users").select("*");
    const r = byId ? await base.eq("tg_id", Number(s)).maybeSingle() : byEmail ? await base.eq("email", s.toLowerCase()).maybeSingle() : await base.ilike("username", s.replace(/[%_]/g, "\\$&")).limit(1).maybeSingle();
    const row = check(r, "findUser");
    return row ? userOf(row) : null;
  }
  for (const u of memUsers.values()) {
    if (byId ? String(u.tgId) === s : byEmail ? (u.email || "").toLowerCase() === s.toLowerCase() : (u.username || "").toLowerCase() === s.toLowerCase()) return withAdmin({ ...u });
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
async function listRecentUsers(limit2 = 10) {
  if (useSupabase) {
    const r = await sb().from("users").select("*").order("created_at", { ascending: false }).limit(limit2);
    return (check(r, "listRecentUsers") || []).map(userOf);
  }
  return [...memUsers.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, limit2).map((u) => withAdmin({ ...u }));
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
async function listSearches(userId, kind, limit2) {
  if (useSupabase) {
    const r = await sb().from("searches").select(SEARCH_COLS).eq("user_id", userId).eq("kind", kind).order("created_at", { ascending: false }).limit(limit2);
    return (check(r, "listSearches") || []).map(searchOf);
  }
  return Array.from(memSearches.values()).filter((s) => s.userId === userId && s.kind === kind).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, limit2);
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
async function rateLimit(key, max, windowMs, failClosed = false) {
  if (useSupabase) {
    const r = await sb().rpc("rate_limit", { p_key: key, p_max: max, p_window_ms: windowMs });
    if (r.error) {
      console.error("[db] rateLimit:", r.error.message);
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
async function consumeBudgetWindow(key, cost, max, windowMs, failClosed = true) {
  const safeCost = Math.max(1, Math.round(cost));
  const now = Date.now();
  if (useSupabase) {
    try {
      const r = await sb().from("rate_limits").select("n,reset_at").eq("key", key).maybeSingle();
      if (r.error) throw new Error(r.error.message);
      const existing = r.data;
      const resetMs = existing?.reset_at ? Date.parse(existing.reset_at) : 0;
      const expired = !existing || !Number.isFinite(resetMs) || resetMs <= now;
      const current = expired ? 0 : Math.max(0, Number(existing.n) || 0);
      if (current + safeCost > max) {
        return { allowed: false, used: current, resetAt: expired ? now + windowMs : resetMs };
      }
      const nextUsed = current + safeCost;
      const nextReset = expired ? new Date(now + windowMs).toISOString() : existing.reset_at;
      const up = await sb().from("rate_limits").upsert({ key, n: nextUsed, reset_at: nextReset }, { onConflict: "key" });
      if (up.error) throw new Error(up.error.message);
      return { allowed: true, used: nextUsed, resetAt: Date.parse(nextReset) };
    } catch (e) {
      console.error("[db] consumeBudgetWindow:", e?.message || e);
      return { allowed: !failClosed, used: 0, resetAt: now + windowMs };
    }
  }
  const entry = memLimits.get(key);
  if (!entry || now > entry.resetAt) {
    if (safeCost > max) return { allowed: false, used: 0, resetAt: now + windowMs };
    const resetAt = now + windowMs;
    memLimits.set(key, { count: safeCost, resetAt });
    return { allowed: true, used: safeCost, resetAt };
  }
  if (entry.count + safeCost > max) {
    return { allowed: false, used: entry.count, resetAt: entry.resetAt };
  }
  entry.count += safeCost;
  return { allowed: true, used: entry.count, resetAt: entry.resetAt };
}
async function getBudgetWindow(key) {
  const now = Date.now();
  if (useSupabase) {
    try {
      const r = await sb().from("rate_limits").select("n,reset_at").eq("key", key).maybeSingle();
      if (!r.error && r.data) {
        const resetMs = Date.parse(r.data.reset_at);
        if (Number.isFinite(resetMs) && resetMs > now) {
          return { used: Math.max(0, Number(r.data.n) || 0), resetAt: resetMs };
        }
      }
    } catch {
    }
    return { used: 0, resetAt: 0 };
  }
  const entry = memLimits.get(key);
  if (!entry || now > entry.resetAt) return { used: 0, resetAt: 0 };
  return { used: entry.count, resetAt: entry.resetAt };
}
async function refundBudgetWindow(key, cost) {
  const safeCost = Math.max(1, Math.round(cost));
  const now = Date.now();
  if (useSupabase) {
    try {
      const r = await sb().from("rate_limits").select("n,reset_at").eq("key", key).maybeSingle();
      if (r.error || !r.data) return;
      const resetMs = Date.parse(r.data.reset_at);
      if (!Number.isFinite(resetMs) || resetMs <= now) return;
      const next = Math.max(0, (Number(r.data.n) || 0) - safeCost);
      await sb().from("rate_limits").update({ n: next }).eq("key", key);
    } catch {
    }
    return;
  }
  const entry = memLimits.get(key);
  if (entry && now <= entry.resetAt) {
    entry.count = Math.max(0, entry.count - safeCost);
  }
}
var memAiUsage = /* @__PURE__ */ new Map();
var utcDay = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
async function aiUsageToday(userId) {
  const day = utcDay();
  const out = { userRequests: 0, userCostUsd: 0, userTokens: 0, totalRequests: 0, totalCostUsd: 0, totalTokens: 0 };
  if (useSupabase) {
    const r = await sb().from("ai_usage").select("user_id,requests,tokens,cost_usd").eq("day", day).limit(2e4);
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
    if (!k.startsWith(day + "|")) continue;
    out.totalRequests += v.requests;
    out.totalCostUsd += v.cost;
    out.totalTokens += v.tokens;
    if (k === `${day}|${userId}`) {
      out.userRequests += v.requests;
      out.userCostUsd += v.cost;
      out.userTokens += v.tokens;
    }
  }
  return out;
}
async function aiUsageAdd(userId, tokens, costUsd) {
  if (useSupabase) {
    const r = await sb().rpc("ai_usage_add", { p_user: userId, p_tokens: Math.round(tokens), p_cost: costUsd });
    if (r.error) throw new Error(`[db] aiUsageAdd: ${r.error.message}`);
    return;
  }
  const k = `${utcDay()}|${userId}`;
  const v = memAiUsage.get(k) ?? { requests: 0, tokens: 0, cost: 0 };
  memAiUsage.set(k, { requests: v.requests + 1, tokens: v.tokens + tokens, cost: v.cost + costUsd });
}
var memAiTokens = /* @__PURE__ */ new Map();
async function aiTokensGet(userId) {
  if (useSupabase) {
    const r = await sb().from("ai_tokens").select("balance").eq("user_id", userId).maybeSingle();
    if (r.error) throw new Error(`[db] aiTokensGet: ${r.error.message}`);
    return Math.max(0, Math.round(Number(r.data?.balance) || 0));
  }
  return Math.max(0, Math.round(memAiTokens.get(userId) || 0));
}
async function aiTokensAdd(userId, tokens) {
  const n = Math.round(tokens);
  if (n <= 0) return;
  if (useSupabase) {
    const r = await sb().rpc("ai_tokens_add", { p_user: userId, p_tokens: n });
    if (r.error) throw new Error(`[db] aiTokensAdd: ${r.error.message}`);
    return;
  }
  memAiTokens.set(userId, (memAiTokens.get(userId) || 0) + n);
}
async function aiTokensSpend(userId, tokens) {
  const n = Math.round(tokens);
  if (n <= 0) return;
  if (useSupabase) {
    const r = await sb().rpc("ai_tokens_spend", { p_user: userId, p_tokens: n });
    if (r.error) throw new Error(`[db] aiTokensSpend: ${r.error.message}`);
    return;
  }
  memAiTokens.set(userId, Math.max(0, (memAiTokens.get(userId) || 0) - n));
}
var memDemos = /* @__PURE__ */ new Map();
var DEMO_TTL_DAYS = 45;
async function demoCreate(userId, html) {
  const id = crypto2.randomBytes(9).toString("base64url");
  if (useSupabase) {
    const r = await sb().from("demos").insert({ id, user_id: userId, size: html.length, html });
    if (r.error) throw new Error(`[db] demoCreate: ${r.error.message}`);
    return id;
  }
  memDemos.set(id, { userId, html, at: Date.now() });
  return id;
}
async function demoGet(id) {
  if (useSupabase) {
    const r = await sb().from("demos").select("html").eq("id", id).gt("created_at", ago(DEMO_TTL_DAYS * 864e5)).maybeSingle();
    if (r.error) throw new Error(`[db] demoGet: ${r.error.message}`);
    return r.data?.html ?? null;
  }
  const d = memDemos.get(id);
  return d && Date.now() - d.at < DEMO_TTL_DAYS * 864e5 ? d.html : null;
}
async function demoCounts(userId) {
  if (useSupabase) {
    const q = (since) => sb().from("demos").select("id", { count: "exact", head: true }).eq("user_id", userId).gt("created_at", ago(since));
    const [d, t] = await Promise.all([q(864e5), q(DEMO_TTL_DAYS * 864e5)]);
    if (d.error || t.error) throw new Error(`[db] demoCounts: ${(d.error || t.error).message}`);
    return { day: d.count ?? 0, total: t.count ?? 0 };
  }
  let day = 0, total = 0;
  for (const v of memDemos.values()) if (v.userId === userId) {
    total++;
    if (Date.now() - v.at < 864e5) day++;
  }
  return { day, total };
}
async function cleanup(retentionDays) {
  if (useSupabase) {
    const c = sb();
    await c.from("login_tokens").delete().lt("created_at", ago(TOKEN_MS));
    await c.from("rate_limits").delete().lt("reset_at", (/* @__PURE__ */ new Date()).toISOString());
    await c.from("searches").delete().lt("created_at", ago(retentionDays * 864e5));
    await c.from("demos").delete().lt("created_at", ago(DEMO_TTL_DAYS * 864e5));
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
var TRAINING_FILE = path.join(process.cwd(), "data", "training.json");
var memTraining = null;
function cloneTraining(list) {
  return list.map((l) => ({ ...l }));
}
function loadLocalTraining() {
  if (memTraining) return cloneTraining(memTraining);
  try {
    if (fs.existsSync(TRAINING_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(TRAINING_FILE, "utf-8"));
      if (Array.isArray(parsed)) {
        memTraining = parsed;
        return cloneTraining(parsed);
      }
    }
  } catch {
  }
  memTraining = [];
  return cloneTraining(memTraining);
}
function saveLocalTraining(lessons) {
  memTraining = cloneTraining(lessons);
  try {
    fs.mkdirSync(path.dirname(TRAINING_FILE), { recursive: true });
    fs.writeFileSync(TRAINING_FILE, JSON.stringify(lessons, null, 2), "utf-8");
  } catch {
  }
}
async function getTraining() {
  if (useSupabase) {
    try {
      const r = await sb().from("app_settings").select("value").eq("key", "training").maybeSingle();
      if (!r.error && Array.isArray(r.data?.value)) {
        memTraining = cloneTraining(r.data.value);
        return cloneTraining(memTraining);
      }
    } catch {
    }
  }
  return loadLocalTraining().sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}
async function saveTraining(lessons) {
  saveLocalTraining(lessons);
  if (useSupabase) {
    const r = await sb().from("app_settings").upsert({ key: "training", value: lessons, updated_at: (/* @__PURE__ */ new Date()).toISOString() }, { onConflict: "key" });
    if (r.error) console.warn("[db] saveTraining supabase:", r.error.message);
  }
}
async function addLesson(title, body) {
  const lessons = await getTraining();
  const lesson = {
    id: newId(),
    title: title.slice(0, 200),
    body: body.slice(0, 2e4),
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    order: lessons.length ? Math.max(...lessons.map((l) => l.order)) + 1 : 0
  };
  lessons.push(lesson);
  await saveTraining(lessons);
  return lesson;
}
async function updateLesson(id, patch) {
  const lessons = await getTraining();
  const target = lessons.find((l) => l.id === id || l.id.startsWith(id));
  if (!target) return null;
  if (patch.title !== void 0) target.title = patch.title.slice(0, 200);
  if (patch.body !== void 0) target.body = patch.body.slice(0, 2e4);
  await saveTraining(lessons);
  return target;
}
async function deleteLesson(id) {
  const lessons = await getTraining();
  const next = lessons.filter((l) => !(l.id === id || l.id.startsWith(id)));
  if (next.length === lessons.length) return false;
  await saveTraining(next);
  return true;
}
var _channelsCache = null;
var CHANNELS_TTL = 6e4;
function normalizeChannels(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const item of raw) {
    const s = String(item).trim().replace(/^@/, "");
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}
async function getRequiredChannels() {
  if (_channelsCache && Date.now() - _channelsCache.at < CHANNELS_TTL) return _channelsCache.list;
  let list = [];
  if (useSupabase) {
    try {
      const r = await sb().from("app_settings").select("value").eq("key", "required_channels").maybeSingle();
      if (!r.error && r.data?.value) {
        const v = typeof r.data.value === "string" ? JSON.parse(r.data.value) : r.data.value;
        list = normalizeChannels(v);
      }
    } catch {
    }
  }
  if (!list.length) list = config.requiredChannels.slice();
  _channelsCache = { at: Date.now(), list };
  return list;
}
async function setRequiredChannels(input) {
  const clean = normalizeChannels(input);
  if (useSupabase) {
    try {
      const r = await sb().from("app_settings").upsert({ key: "required_channels", value: clean, updated_at: (/* @__PURE__ */ new Date()).toISOString() }, { onConflict: "key" });
      if (r.error) console.warn("[db] setRequiredChannels supabase:", r.error.message);
    } catch (e) {
      console.warn("[db] setRequiredChannels:", e?.message || e);
    }
  }
  _channelsCache = { at: Date.now(), list: clean };
  return clean;
}
var clonePromocodes = (list) => list.map((p) => ({ ...p }));
var PROMOCODES_FILE = path.join(process.cwd(), "data", "promocodes.json");
var memPromocodes = null;
function loadLocalPromocodes() {
  if (memPromocodes) return clonePromocodes(memPromocodes);
  try {
    if (fs.existsSync(PROMOCODES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PROMOCODES_FILE, "utf-8"));
      if (Array.isArray(parsed)) {
        memPromocodes = parsed;
        return clonePromocodes(parsed);
      }
    }
  } catch {
  }
  memPromocodes = [];
  return clonePromocodes(memPromocodes);
}
function saveLocalPromocodes(list) {
  memPromocodes = clonePromocodes(list);
  try {
    fs.mkdirSync(path.dirname(PROMOCODES_FILE), { recursive: true });
    fs.writeFileSync(PROMOCODES_FILE, JSON.stringify(list, null, 2), "utf-8");
  } catch {
  }
}
async function getPromocodes() {
  if (useSupabase) {
    try {
      const r = await sb().from("app_settings").select("value").eq("key", "promocodes").maybeSingle();
      if (!r.error && Array.isArray(r.data?.value)) {
        memPromocodes = clonePromocodes(r.data.value);
        return clonePromocodes(memPromocodes);
      }
    } catch {
    }
  }
  return loadLocalPromocodes();
}
async function savePromocodes(list) {
  saveLocalPromocodes(list);
  if (useSupabase) {
    try {
      const r = await sb().from("app_settings").upsert({ key: "promocodes", value: list, updated_at: (/* @__PURE__ */ new Date()).toISOString() }, { onConflict: "key" });
      if (r.error) console.warn("[db] savePromocodes supabase:", r.error.message);
    } catch (e) {
      console.warn("[db] savePromocodes:", e?.message || e);
    }
  }
}
function normalizeCode(raw) {
  return String(raw || "").trim().toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9\-]/g, "");
}
async function savePromoCode(input) {
  const list = await getPromocodes();
  const code = normalizeCode(input.code);
  if (!code) throw Object.assign(new Error("\u041F\u0443\u0441\u0442\u043E\u0439 \u043A\u043E\u0434 \u043F\u0440\u043E\u043C\u043E\u043A\u043E\u0434\u0430"), { status: 400 });
  const discount = Math.round(Number(input.discountPercent));
  if (!(discount >= 1 && discount <= 100)) throw Object.assign(new Error("\u0421\u043A\u0438\u0434\u043A\u0430: 1\u2013100 %"), { status: 400 });
  const maxUses = Math.max(0, Math.round(Number(input.maxUses) || 0));
  let validUntil = null;
  if (input.validUntil && !/^\s*$/.test(String(input.validUntil))) {
    const d = new Date(String(input.validUntil));
    if (!isNaN(d.getTime())) validUntil = d.toISOString();
  }
  const id = input.id || newId();
  const existing = list.find((p) => p.id === id);
  const dup = list.find((p) => p.code.toUpperCase() === code && p.id !== id);
  if (dup) throw Object.assign(new Error(`\u041A\u043E\u0434 ${code} \u0443\u0436\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442`), { status: 409 });
  const promo = {
    id,
    code,
    discountPercent: discount,
    maxUses,
    usedCount: existing?.usedCount ?? 0,
    validUntil,
    active: Boolean(input.active),
    note: String(input.note || "").slice(0, 200),
    createdAt: existing?.createdAt ?? (/* @__PURE__ */ new Date()).toISOString()
  };
  const next = existing ? list.map((p) => p.id === id ? promo : p) : [...list, promo];
  await savePromocodes(next);
  return promo;
}
async function deletePromoCode(id) {
  const list = await getPromocodes();
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) return false;
  await savePromocodes(next);
  return true;
}
async function togglePromoCode(id) {
  const list = await getPromocodes();
  const target = list.find((p) => p.id === id);
  if (!target) return null;
  target.active = !target.active;
  await savePromocodes(list);
  return target;
}
async function findActivePromoCode(rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  const list = await getPromocodes();
  const now = Date.now();
  const promo = list.find((p) => p.code === code);
  if (!promo || !promo.active) return null;
  if (promo.validUntil && Date.parse(promo.validUntil) < now) return null;
  if (promo.maxUses > 0 && promo.usedCount >= promo.maxUses) return null;
  return promo;
}
async function incrementPromoUse(id) {
  const list = await getPromocodes();
  const target = list.find((p) => p.id === id);
  if (!target) return;
  target.usedCount += 1;
  await savePromocodes(list);
}
async function validatePromoCode(rawCode) {
  const promo = await findActivePromoCode(rawCode);
  if (!promo) return null;
  return { discountPercent: promo.discountPercent, code: promo.code };
}

// server/util.ts
import crypto3 from "node:crypto";
function norm(s) {
  return s.toLowerCase().replace(/ё/g, "\u0435").replace(/[-–—_.,]/g, " ").replace(/\s+/g, " ").trim();
}
function hashStr(s) {
  let h5 = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h5 ^= s.charCodeAt(i);
    h5 = Math.imul(h5, 16777619);
  }
  return h5 >>> 0;
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
  if (tgId == null || !config.botToken) return;
  try {
    await tg("sendMessage", { chat_id: tgId, text, ...extra });
  } catch (e) {
    console.error("[bot] sendMessage", e);
  }
}
var botIdCache = 0;
async function getBotId() {
  if (botIdCache || !config.botToken) return botIdCache;
  const me = await tg("getMe");
  if (me.ok) botIdCache = me.result.id;
  return botIdCache;
}
async function resolveChannel(ch) {
  const id = String(ch || "").trim().replace(/^@/, "");
  if (!id) return { ok: false, error: "empty" };
  try {
    const chat = await tg("getChat", { chat_id: id });
    if (!chat.ok) return { ok: false, id, error: chat.description || "\u043A\u0430\u043D\u0430\u043B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0438\u043B\u0438 \u0431\u043E\u0442 \u043D\u0435 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A" };
    const r = chat.result;
    const bid = await getBotId();
    let botIsAdmin = false;
    if (bid) {
      const m = await tg("getChatMember", { chat_id: id, user_id: bid }).catch(() => null);
      const st = m?.result?.status;
      botIsAdmin = st === "administrator" || st === "creator";
    }
    return {
      ok: true,
      id: String(r.id ?? id),
      title: r.title || (r.username ? "@" + r.username : id),
      username: r.username ? "@" + r.username : "",
      type: r.type,
      botIsAdmin
    };
  } catch (e) {
    return { ok: false, id, error: e?.message || "\u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0440\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u044C \u043A\u0430\u043D\u0430\u043B" };
  }
}
var subsCache = /* @__PURE__ */ new Map();
var SUBS_TTL = 6e4;
async function checkChannelSubs(tgId) {
  if (tgId == null) return true;
  const channels = await getRequiredChannels();
  if (!channels.length) return true;
  if (config.adminTgId > 0 && tgId === config.adminTgId) return true;
  const c = subsCache.get(tgId);
  if (c && Date.now() - c.at < SUBS_TTL) return c.ok;
  let ok = true;
  try {
    for (const ch of channels) {
      const r = await tg("getChatMember", { chat_id: ch, user_id: tgId });
      const st = r?.result?.status;
      if (!["creator", "administrator", "member", "restricted"].includes(st)) {
        ok = false;
        break;
      }
    }
  } catch (e) {
    console.warn("[bot] checkChannelSubs", tgId, e);
    ok = true;
  }
  subsCache.set(tgId, { at: Date.now(), ok });
  return ok;
}
var channelUrl = (ch) => ch.startsWith("-") ? null : `https://t.me/${ch}`;
async function subsGateKb(intent, param) {
  const channels = await getRequiredChannels();
  const rows = channels.map((ch) => {
    const url = channelUrl(ch);
    const text = ch.startsWith("-") ? `\u{1F4E2} \u041A\u0430\u043D\u0430\u043B ${ch}` : `\u{1F4E2} @${ch}`;
    return url ? [{ text, url }] : [{ text, callback_data: "sub:nop" }];
  });
  const cb = intent === "login" ? `sub:check:lt:${param}` : "sub:check:ref";
  rows.push([{ text: "\u2705 \u042F \u043F\u043E\u0434\u043F\u0438\u0441\u0430\u043B\u0441\u044F \u2014 \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C", callback_data: cb }]);
  return { inline_keyboard: rows };
}
var SUBS_GATE_TEXT = "\u0427\u0442\u043E\u0431\u044B \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C, \u043F\u043E\u0434\u043F\u0438\u0448\u0438\u0442\u0435\u0441\u044C \u043D\u0430 \u0432\u0441\u0435 \u043A\u0430\u043D\u0430\u043B\u044B \u043D\u0438\u0436\u0435 \u2014 \u0442\u0430\u043A \u0432\u044B \u043F\u043E\u043B\u0443\u0447\u0430\u0435\u0442\u0435 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F \u0438 \u0432\u0430\u0436\u043D\u044B\u0435 \u043D\u043E\u0432\u043E\u0441\u0442\u0438 \u0441\u0435\u0440\u0432\u0438\u0441\u0430.\n\n\u041F\u043E\u0441\u043B\u0435 \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u2705 \u042F \u043F\u043E\u0434\u043F\u0438\u0441\u0430\u043B\u0441\u044F \u2014 \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C\xBB.";
async function finalizeStart(chatId, user, intent, param) {
  const base = publicUrl();
  if (intent === "login") {
    const ok = await bindLoginToken(param, user.id);
    if (!ok) {
      await notify(chatId, "\u0421\u0441\u044B\u043B\u043A\u0430 \u0443\u0441\u0442\u0430\u0440\u0435\u043B\u0430. \u0412\u0435\u0440\u043D\u0438\u0442\u0435\u0441\u044C \u043D\u0430 \u0441\u0430\u0439\u0442 \u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u0412\u043E\u0439\u0442\u0438 \u0447\u0435\u0440\u0435\u0437 Telegram\xBB \u0435\u0449\u0451 \u0440\u0430\u0437.", { reply_markup: docsMarkup(true) });
      return;
    }
    await notify(
      chatId,
      `\u2705 \u0413\u043E\u0442\u043E\u0432\u043E, ${user.firstName}! \u0412\u0435\u0440\u043D\u0438\u0442\u0435\u0441\u044C \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440 \u2014 \u0432\u0445\u043E\u0434 \u0432\u044B\u043F\u043E\u043B\u043D\u0438\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438.

\u041F\u0440\u0430\u0432\u043E\u0432\u044B\u0435 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u044B \u0441\u0435\u0440\u0432\u0438\u0441\u0430 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B \u043F\u043E \u043A\u043D\u043E\u043F\u043A\u0430\u043C \u043D\u0438\u0436\u0435:`,
      { reply_markup: docsMarkup(false) }
    );
    return;
  }
  const token = randomToken(24);
  await createLoginToken(token);
  await bindLoginToken(token, user.id);
  await notify(
    chatId,
    `\u2705 \u0421\u043F\u0430\u0441\u0438\u0431\u043E, ${user.firstName}! \u0412\u044B \u043F\u043E\u0434\u043F\u0438\u0441\u0430\u043B\u0438\u0441\u044C.

\u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u043A\u043D\u043E\u043F\u043A\u0443 \u043D\u0438\u0436\u0435, \u0447\u0442\u043E\u0431\u044B \u0432\u043E\u0439\u0442\u0438 \u0432 \u043B\u0438\u0447\u043D\u044B\u0439 \u043A\u0430\u0431\u0438\u043D\u0435\u0442:`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "\u{1F310} \u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043B\u0438\u0447\u043D\u044B\u0439 \u043A\u0430\u0431\u0438\u043D\u0435\u0442", url: `${base}/app?token=${token}` }],
          ...docsMarkup(false).inline_keyboard
        ]
      }
    }
  );
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
var who = (u) => u.tgId == null ? `${u.username ? "@" + u.username : u.firstName} (\u0432\u0445\u043E\u0434 \u043F\u043E \u043F\u043E\u0447\u0442\u0435${u.email ? ": " + u.email : ""})` : `${u.username ? "@" + u.username : u.firstName} (id ${u.tgId})`;
var ADMIN_HELP = `\u0410\u0434\u043C\u0438\u043D-\u043F\u0430\u043D\u0435\u043B\u044C Fracs

\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0438:
/grant <@username|id> [\u0434\u043D\u0435\u0439] [\u0442\u0430\u0440\u0438\u0444] \u2014 \u0432\u044B\u0434\u0430\u0442\u044C \u0438\u043B\u0438 \u043F\u0440\u043E\u0434\u043B\u0438\u0442\u044C \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0443 (\u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E 30 \u0434\u043D\u0435\u0439, \u0442\u0430\u0440\u0438\u0444 month)
/granttokens <@username|id|email> <\u0442\u043E\u043A\u0435\u043D\u044B|packId> \u2014 \u0432\u044B\u0434\u0430\u0442\u044C \u043B\u0438\u043C\u0438\u0442\u044B Fracs AI (\u043D\u0430\u043F\u0440. 500000, 500k, tokens_500k)
/revoke <@username|id> \u2014 \u0441\u043D\u044F\u0442\u044C \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0443
/user <@username|id> \u2014 \u0441\u0442\u0430\u0442\u0443\u0441 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F
/users \u2014 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 10 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0435\u0439

\u0422\u0430\u0440\u0438\u0444\u044B \u0438 \u0446\u0435\u043D\u044B:
/plans \u2014 \u0441\u043F\u0438\u0441\u043E\u043A \u0442\u0435\u043A\u0443\u0449\u0438\u0445 \u0442\u0430\u0440\u0438\u0444\u043E\u0432
/setprice <id|1|2|3> <\u0446\u0435\u043D\u0430> \u2014 \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0446\u0435\u043D\u0443 (\u20BD)
/setdesc <id|1|2|3> <\u043E\u043F\u0438\u0441\u0430\u043D\u0438\u0435|-> \u2014 \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u043E\u043F\u0438\u0441\u0430\u043D\u0438\u0435 (- \u0447\u0442\u043E\u0431\u044B \u0443\u0431\u0440\u0430\u0442\u044C)
/settitle <id|1|2|3> <\u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435> \u2014 \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435
/setbadge <id|1|2|3> <\u0442\u0435\u043A\u0441\u0442|-> \u2014 \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0431\u0435\u0439\u0434\u0436 (- \u0447\u0442\u043E\u0431\u044B \u0443\u0431\u0440\u0430\u0442\u044C)
/setdays <id|1|2|3> <\u0434\u043D\u0435\u0439> \u2014 \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0434\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C
/resetplans \u2014 \u0441\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u0442\u0430\u0440\u0438\u0444\u044B \u043A \u0441\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u043D\u044B\u043C

\u0420\u0430\u0437\u0434\u0435\u043B \xAB\u041E\u0431\u0443\u0447\u0435\u043D\u0438\u0435\xBB (\u0432\u0438\u0434\u0435\u043D \u0432 \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0435 \u043D\u0430 \u0442\u0430\u0440\u0438\u0444\u0430\u0445 PRO \u0438 Ultra):
/training \u2014 \u0441\u043F\u0438\u0441\u043E\u043A \u0443\u0440\u043E\u043A\u043E\u0432
/addlesson \u0417\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A
<\u043F\u0443\u0441\u0442\u0430\u044F \u0441\u0442\u0440\u043E\u043A\u0430>
\u0422\u0435\u043A\u0441\u0442 \u0443\u0440\u043E\u043A\u0430 (\u043C\u043E\u0436\u043D\u043E \u043C\u043D\u043E\u0433\u043E\u0441\u0442\u0440\u043E\u0447\u043D\u043E) \u2014 \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0443\u0440\u043E\u043A
/setlesson <id> \u0417\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A
<\u043F\u0443\u0441\u0442\u0430\u044F \u0441\u0442\u0440\u043E\u043A\u0430>
\u041D\u043E\u0432\u044B\u0439 \u0442\u0435\u043A\u0441\u0442 \u2014 \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0443\u0440\u043E\u043A (id \u0438\u0437 /training, \u043C\u043E\u0436\u043D\u043E \u043F\u0435\u0440\u0432\u044B\u0435 8 \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432)
/dellesson <id> \u2014 \u0443\u0434\u0430\u043B\u0438\u0442\u044C \u0443\u0440\u043E\u043A

\u041F\u0440\u0438\u043C\u0435\u0440\u044B:
/setprice pro 2700
/grant 123456789 30 pro
/granttokens 123456789 500000
/addlesson \u041A\u0430\u043A \u043D\u0430\u0439\u0442\u0438 \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432

\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043D\u0438\u0448\u0443, \u0432\u0432\u0435\u0434\u0438\u0442\u0435 \u0433\u043E\u0440\u043E\u0434\u2026`;
var ADMIN_CMDS = [
  "/admin",
  "/grant",
  "/granttokens",
  "/revoke",
  "/user",
  "/users",
  "/plans",
  "/setprice",
  "/setdesc",
  "/settitle",
  "/setbadge",
  "/setdays",
  "/resetplans",
  "/training",
  "/addlesson",
  "/setlesson",
  "/dellesson"
];
function formatPlans(plans) {
  return plans.map(
    (p, i) => `${i + 1}. [${p.id}] ${p.title} \u2014 ${p.priceRub.toLocaleString("ru-RU")} \u20BD (${p.days} \u0434\u043D.)` + (p.badge ? `
   \u0411\u0435\u0439\u0434\u0436: ${p.badge}` : "") + `
   \u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435: ${p.description || "\u2014"}`
  ).join("\n\n");
}
var admUrl = () => `${publicUrl()}/admin.html`;
function adminHomeKb() {
  return {
    inline_keyboard: [
      [{ text: "\u{1F5A5} \u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u0430\u043D\u0435\u043B\u044C", web_app: { url: admUrl() } }],
      [{ text: "\u{1F465} \u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0438", callback_data: "adm:users" }, { text: "\u{1F4B0} \u0422\u0430\u0440\u0438\u0444\u044B", callback_data: "adm:plans" }],
      [{ text: "\u{1F393} \u041E\u0431\u0443\u0447\u0435\u043D\u0438\u0435", callback_data: "adm:train" }, { text: "\u2139\uFE0F \u041A\u043E\u043C\u0430\u043D\u0434\u044B", callback_data: "adm:help" }]
    ]
  };
}
var adminHomeText = "\u{1F5A5} \u0410\u0434\u043C\u0438\u043D-\u043F\u0430\u043D\u0435\u043B\u044C Fracs\n\n\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043F\u043E\u043B\u043D\u0443\u044E \u043F\u0430\u043D\u0435\u043B\u044C \u043A\u043D\u043E\u043F\u043A\u043E\u0439 \u043D\u0438\u0436\u0435 \u0438\u043B\u0438 \u043F\u043E\u0441\u043C\u043E\u0442\u0440\u0438\u0442\u0435 \u0431\u044B\u0441\u0442\u0440\u0443\u044E \u0441\u0432\u043E\u0434\u043A\u0443 \u043F\u043E \u0440\u0430\u0437\u0434\u0435\u043B\u0430\u043C. \u041A\u043E\u043C\u0430\u043D\u0434\u044B (/grant, /plans \u2026) \u0442\u043E\u0436\u0435 \u0440\u0430\u0431\u043E\u0442\u0430\u044E\u0442.";
var backKb = (cb) => ({ inline_keyboard: [[{ text: "\u2190 \u041D\u0430\u0437\u0430\u0434", callback_data: cb }]] });
async function editMsg(chatId, messageId, text, markup) {
  await tg("editMessageText", { chat_id: chatId, message_id: messageId, text, reply_markup: markup }).catch(() => {
  });
}
async function answerCb(cbId, text = "", alert = false) {
  await tg("answerCallbackQuery", { callback_query_id: cbId, text, show_alert: alert }).catch(() => {
  });
}
async function sendAdminMenu(chatId) {
  await notify(chatId, adminHomeText, { reply_markup: adminHomeKb() });
}
async function renderUserView(chatId, messageId, tgId) {
  const u = await findUser(String(tgId));
  if (!u) {
    await editMsg(chatId, messageId, "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u2014 \u043F\u0443\u0441\u0442\u044C \u0441\u043D\u0430\u0447\u0430\u043B\u0430 \u0432\u043E\u0439\u0434\u0451\u0442 \u0432 \u043A\u0430\u0431\u0438\u043D\u0435\u0442 \u0447\u0435\u0440\u0435\u0437 \u0431\u043E\u0442\u0430.", backKb("adm:users"));
    return;
  }
  const bal = await aiTokensGet(u.id).catch(() => 0);
  const text = `\u{1F464} ${who(u)}
\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430: ${isSubscribed(u) ? "\u0434\u043E " + fmt(u.subscriptionUntil) : "\u043D\u0435\u0442"}${u.planId ? ` (${u.planId})` : ""}
\u0422\u043E\u043A\u0435\u043D\u044B Fracs AI: ${bal.toLocaleString("ru-RU")}
\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044F: ${fmt(u.createdAt)}`;
  const kb = {
    inline_keyboard: [
      [{ text: "Ultra 30 \u0434\u043D\u0435\u0439", callback_data: `adm:g:${tgId}:ultra:30` }, { text: "PRO 30 \u0434\u043D\u0435\u0439", callback_data: `adm:g:${tgId}:pro:30` }],
      [{ text: "Start 30 \u0434\u043D\u0435\u0439", callback_data: `adm:g:${tgId}:start:30` }],
      [
        { text: "+100\u043A \u0442\u043E\u043A.", callback_data: `adm:gt:${tgId}:100000` },
        { text: "+500\u043A \u0442\u043E\u043A.", callback_data: `adm:gt:${tgId}:500000` },
        { text: "+1\u041C \u0442\u043E\u043A.", callback_data: `adm:gt:${tgId}:1000000` }
      ],
      [{ text: "\u2715 \u0421\u043D\u044F\u0442\u044C \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0443", callback_data: `adm:r:${tgId}` }],
      [{ text: "\u2190 \u041A \u0441\u043F\u0438\u0441\u043A\u0443", callback_data: "adm:users" }]
    ]
  };
  await editMsg(chatId, messageId, text, kb);
}
async function handleAdminCallback(cb) {
  const data = cb?.data || "";
  if (!data.startsWith("adm:")) return false;
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  const cbId = cb.id;
  if (!chatId || !messageId) return false;
  if (data === "adm:home") {
    await editMsg(chatId, messageId, adminHomeText, adminHomeKb());
    await answerCb(cbId);
    return true;
  }
  if (data === "adm:help") {
    await editMsg(chatId, messageId, ADMIN_HELP, backKb("adm:home"));
    await answerCb(cbId);
    return true;
  }
  if (data === "adm:users") {
    const list = await listRecentUsers(8);
    if (!list.length) {
      await editMsg(chatId, messageId, "\u{1F465} \u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0435\u0439 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442.", backKb("adm:home"));
      await answerCb(cbId);
      return true;
    }
    const rows = list.map((u) => [
      {
        text: `${(u.username || u.firstName || u.email || "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C").slice(0, 20)}${isSubscribed(u) ? " \u2705" : " \u2B1C"}`,
        callback_data: u.tgId != null ? `adm:u:${u.tgId}` : `adm:uid:${u.id}`
      }
    ]);
    rows.push([{ text: "\u2190 \u041D\u0430\u0437\u0430\u0434", callback_data: "adm:home" }]);
    await editMsg(chatId, messageId, "\u{1F465} \u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0438\n\n\u0422\u0430\u043F\u043D\u0438\u0442\u0435 \u043F\u043E \u0441\u0442\u0440\u043E\u043A\u0435, \u0447\u0442\u043E\u0431\u044B \u0432\u044B\u0434\u0430\u0442\u044C \u0438\u043B\u0438 \u0441\u043D\u044F\u0442\u044C \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0443:", { inline_keyboard: rows });
    await answerCb(cbId);
    return true;
  }
  if (data === "adm:plans") {
    const plans = await getPlans();
    const kb = { inline_keyboard: [[{ text: "\u267B\uFE0F \u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u043A \u0441\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u043D\u044B\u043C", callback_data: "adm:plansreset" }], [{ text: "\u2190 \u041D\u0430\u0437\u0430\u0434", callback_data: "adm:home" }]] };
    await editMsg(chatId, messageId, "\u{1F4B0} \u0422\u0430\u0440\u0438\u0444\u044B:\n\n" + formatPlans(plans), kb);
    await answerCb(cbId);
    return true;
  }
  if (data === "adm:plansreset") {
    const plans = await resetPlans();
    await editMsg(chatId, messageId, "\u267B\uFE0F \u0422\u0430\u0440\u0438\u0444\u044B \u0441\u0431\u0440\u043E\u0448\u0435\u043D\u044B \u043A \u0441\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u043D\u044B\u043C:\n\n" + formatPlans(plans), backKb("adm:home"));
    await answerCb(cbId, "\u0421\u0431\u0440\u043E\u0448\u0435\u043D\u043E \u043A \u0441\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u043D\u044B\u043C");
    return true;
  }
  if (data === "adm:train") {
    const lessons = await getTraining();
    const text = lessons.length ? "\u{1F393} \u0423\u0440\u043E\u043A\u0438:\n\n" + lessons.map((l, i) => `${i + 1}. ${l.title}`).join("\n") : "\u{1F393} \u0423\u0440\u043E\u043A\u043E\u0432 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442.";
    const kb = { inline_keyboard: [[{ text: "\u{1F5A5} \u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0432 \u043F\u0430\u043D\u0435\u043B\u0438", web_app: { url: admUrl() } }], [{ text: "\u2190 \u041D\u0430\u0437\u0430\u0434", callback_data: "adm:home" }]] };
    await editMsg(chatId, messageId, text, kb);
    await answerCb(cbId);
    return true;
  }
  const m = data.match(/^adm:u:(\d+)$/);
  if (m) {
    await renderUserView(chatId, messageId, Number(m[1]));
    await answerCb(cbId);
    return true;
  }
  const mUid = data.match(/^adm:uid:([0-9a-f-]+)$/i);
  if (mUid) {
    const u = await getUser(mUid[1]);
    if (!u) return answerCb(cbId, "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D", true).then(() => true);
    const bal = await aiTokensGet(u.id).catch(() => 0);
    const text = `\u{1F464} ${who(u)}
\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430: ${isSubscribed(u) ? "\u0434\u043E " + fmt(u.subscriptionUntil) : "\u043D\u0435\u0442"}${u.planId ? ` (${u.planId})` : ""}
\u0422\u043E\u043A\u0435\u043D\u044B Fracs AI: ${bal.toLocaleString("ru-RU")}
\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044F: ${fmt(u.createdAt)}`;
    const kb = {
      inline_keyboard: [
        [{ text: "Ultra 30 \u0434\u043D\u0435\u0439", callback_data: `adm:g:${u.id}:ultra:30` }, { text: "PRO 30 \u0434\u043D\u0435\u0439", callback_data: `adm:g:${u.id}:pro:30` }],
        [{ text: "Start 30 \u0434\u043D\u0435\u0439", callback_data: `adm:g:${u.id}:start:30` }],
        [
          { text: "+100\u043A \u0442\u043E\u043A.", callback_data: `adm:gt:${u.id}:100000` },
          { text: "+500\u043A \u0442\u043E\u043A.", callback_data: `adm:gt:${u.id}:500000` },
          { text: "+1\u041C \u0442\u043E\u043A.", callback_data: `adm:gt:${u.id}:1000000` }
        ],
        [{ text: "\u2715 \u0421\u043D\u044F\u0442\u044C \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0443", callback_data: `adm:r:${u.id}` }],
        [{ text: "\u2190 \u041A \u0441\u043F\u0438\u0441\u043A\u0443", callback_data: "adm:users" }]
      ]
    };
    await editMsg(chatId, messageId, text, kb);
    await answerCb(cbId);
    return true;
  }
  const gt = data.match(/^adm:gt:([^:]+):(\d+)$/);
  if (gt) {
    const target = gt[1];
    const tokens = Number(gt[2]);
    const u = /^\d+$/.test(target) ? await findUser(target) : await getUser(target);
    if (!u) return answerCb(cbId, "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D", true).then(() => true);
    if (!(tokens > 0 && tokens <= 5e7)) return answerCb(cbId, "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u043E\u0435 \u0447\u0438\u0441\u043B\u043E \u0442\u043E\u043A\u0435\u043D\u043E\u0432", true).then(() => true);
    await aiTokensAdd(u.id, tokens);
    await Promise.all([
      refundBudgetWindow(`ai-cx-day:${u.id}`, 1e4),
      refundBudgetWindow(`ai-phrase-day:${u.id}`, 1e4)
    ]).catch(() => {
    });
    const bal = await aiTokensGet(u.id).catch(() => tokens);
    await answerCb(cbId, `\u26A1\uFE0F +${tokens.toLocaleString("ru-RU")} \u0442\u043E\u043A. (\u0431\u0430\u043B\u0430\u043D\u0441: ${bal.toLocaleString("ru-RU")})`);
    await notify(u.tgId, `\u26A1\uFE0F \u041B\u0438\u043C\u0438\u0442\u044B Fracs AI \u043F\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u044B: +${tokens.toLocaleString("ru-RU")} \u0442\u043E\u043A\u0435\u043D\u043E\u0432 (\u0431\u0430\u043B\u0430\u043D\u0441: ${bal.toLocaleString("ru-RU")}). \u041A\u0430\u0431\u0438\u043D\u0435\u0442: ${publicUrl()}/app`).catch(() => {
    });
    if (u.tgId != null) {
      await renderUserView(chatId, messageId, u.tgId);
    } else {
      await editMsg(chatId, messageId, `\u{1F464} ${who(u)}
\u0422\u043E\u043A\u0435\u043D\u044B Fracs AI: ${bal.toLocaleString("ru-RU")}`, backKb("adm:users"));
    }
    return true;
  }
  const g = data.match(/^adm:g:([^:]+):(\w+):(\d+)$/);
  if (g) {
    const target = g[1];
    const planId = g[2];
    const days = Number(g[3]);
    const u = /^\d+$/.test(target) ? await findUser(target) : await getUser(target);
    if (!u) return answerCb(cbId, "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D", true).then(() => true);
    const plans = await getPlans();
    if (!plans.some((p) => p.id === planId)) return answerCb(cbId, `\u0422\u0430\u0440\u0438\u0444 ${planId} \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D`, true).then(() => true);
    const upd = await extendSubscription(u.id, days, planId);
    await answerCb(cbId, `\u2705 ${planId.toUpperCase()} ${days} \u0434\u043D. \u0434\u043E ${fmt(upd.subscriptionUntil)}`);
    await notify(upd.tgId, `\u2705 \u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 Fracs \u0430\u043A\u0442\u0438\u0432\u043D\u0430 \u0434\u043E ${fmt(upd.subscriptionUntil)}. \u041A\u0430\u0431\u0438\u043D\u0435\u0442: ${publicUrl()}/app`).catch(() => {
    });
    if (upd.tgId != null) {
      await renderUserView(chatId, messageId, upd.tgId);
    } else {
      await editMsg(chatId, messageId, `\u{1F464} ${who(upd)}
\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430: \u0434\u043E ${fmt(upd.subscriptionUntil)} (${planId})`, backKb("adm:users"));
    }
    return true;
  }
  const r = data.match(/^adm:r:([^:]+)$/);
  if (r) {
    const target = r[1];
    const u = /^\d+$/.test(target) ? await findUser(target) : await getUser(target);
    if (!u) return answerCb(cbId, "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D", true).then(() => true);
    await setSubscription(u.id, null);
    await answerCb(cbId, "\u{1F6AB} \u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 \u0441\u043D\u044F\u0442\u0430");
    if (u.tgId != null) {
      await renderUserView(chatId, messageId, u.tgId);
    } else {
      await editMsg(chatId, messageId, `\u{1F464} ${who(u)}
\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430: \u043D\u0435\u0442`, backKb("adm:users"));
    }
    return true;
  }
  return false;
}
async function handleAdmin(chatId, text) {
  const trimmed = text.trim();
  const [raw, ...args] = trimmed.split(/\s+/);
  const cmd = raw.split("@")[0].toLowerCase();
  if (!ADMIN_CMDS.includes(cmd)) return false;
  if (cmd === "/admin") {
    await sendAdminMenu(chatId);
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
  if (cmd === "/training") {
    const lessons = await getTraining();
    await notify(
      chatId,
      lessons.length ? "\u0423\u0440\u043E\u043A\u0438:\n\n" + lessons.map((l, i) => `${i + 1}. [${l.id.slice(0, 8)}] ${l.title}`).join("\n") : "\u0423\u0440\u043E\u043A\u043E\u0432 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442. \u0414\u043E\u0431\u0430\u0432\u044C\u0442\u0435:\n/addlesson \u0417\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A\n\n\u0422\u0435\u043A\u0441\u0442 \u0443\u0440\u043E\u043A\u0430"
    );
    return true;
  }
  if (cmd === "/addlesson" || cmd === "/setlesson") {
    const rest = trimmed.slice(raw.length).trim();
    let id = "";
    let content = rest;
    if (cmd === "/setlesson") {
      const m = rest.match(/^(\S+)\s+([\s\S]+)$/);
      if (!m) {
        await notify(chatId, "\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0438\u0435:\n/setlesson <id> <\u0417\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A>\n\n\u0422\u0435\u043A\u0441\u0442 \u0443\u0440\u043E\u043A\u0430");
        return true;
      }
      id = m[1];
      content = m[2];
    }
    const parts = content.split(/\n\s*\n/);
    const title = (parts[0] || "").trim();
    const body = parts.slice(1).join("\n\n").trim();
    if (!title) {
      await notify(chatId, `\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A. \u0424\u043E\u0440\u043C\u0430\u0442:
${cmd} \u0417\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A

\u0422\u0435\u043A\u0441\u0442 \u0443\u0440\u043E\u043A\u0430 (\u043C\u043E\u0436\u043D\u043E \u043C\u043D\u043E\u0433\u043E\u0441\u0442\u0440\u043E\u0447\u043D\u043E)`);
      return true;
    }
    if (cmd === "/addlesson") {
      const l = await addLesson(title, body);
      await notify(chatId, `\u2705 \u0423\u0440\u043E\u043A \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D: [${l.id.slice(0, 8)}] ${l.title}
\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C: /setlesson ${l.id.slice(0, 8)} \u2026
\u0423\u0434\u0430\u043B\u0438\u0442\u044C: /dellesson ${l.id.slice(0, 8)}`);
    } else {
      const l = await updateLesson(id, { title, ...body !== "" ? { body } : {} });
      if (!l) {
        await notify(chatId, `\u0423\u0440\u043E\u043A \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D: ${id}. \u0421\u043F\u0438\u0441\u043E\u043A: /training`);
        return true;
      }
      await notify(chatId, `\u2705 \u0423\u0440\u043E\u043A \u043E\u0431\u043D\u043E\u0432\u043B\u0451\u043D: [${l.id.slice(0, 8)}] ${l.title}`);
    }
    return true;
  }
  if (cmd === "/dellesson") {
    const id = args[0];
    if (!id) {
      await notify(chatId, "\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0438\u0435: /dellesson <id>");
      return true;
    }
    const ok = await deleteLesson(id);
    await notify(chatId, ok ? `\u2705 \u0423\u0440\u043E\u043A \u0443\u0434\u0430\u043B\u0451\u043D: ${id}` : `\u0423\u0440\u043E\u043A \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D: ${id}. \u0421\u043F\u0438\u0441\u043E\u043A: /training`);
    return true;
  }
  const user = args[0] ? await findUser(args[0]) : null;
  if (!user) {
    await notify(chatId, args[0] ? "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D. \u041E\u043D \u0434\u043E\u043B\u0436\u0435\u043D \u0441\u043D\u0430\u0447\u0430\u043B\u0430 \u0432\u043E\u0439\u0442\u0438 \u0432 \u043A\u0430\u0431\u0438\u043D\u0435\u0442 \u0447\u0435\u0440\u0435\u0437 \u0431\u043E\u0442\u0430." : ADMIN_HELP);
    return true;
  }
  if (cmd === "/user") {
    const bal = await aiTokensGet(user.id).catch(() => 0);
    await notify(chatId, `${who(user)}
\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430: ${isSubscribed(user) ? "\u0434\u043E " + fmt(user.subscriptionUntil) : "\u043D\u0435\u0442"}
\u0422\u043E\u043A\u0435\u043D\u044B Fracs AI: ${bal.toLocaleString("ru-RU")}
\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044F: ${fmt(user.createdAt)}`);
  } else if (cmd === "/grant") {
    const days = Math.round(Number(args[1] ?? 30));
    if (!(days > 0 && days <= 3650)) {
      await notify(chatId, "\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u0447\u0438\u0441\u043B\u043E \u0434\u043D\u0435\u0439 \u043E\u0442 1 \u0434\u043E 3650.");
      return true;
    }
    const planId = args[2];
    if (planId) {
      const plans = await getPlans();
      if (!plans.some((p) => p.id === planId)) {
        await notify(chatId, `\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0439 \u0442\u0430\u0440\u0438\u0444: ${planId}. \u0414\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0435: ${plans.map((p) => p.id).join(", ")}`);
        return true;
      }
    }
    const u = await extendSubscription(user.id, days, planId);
    await notify(chatId, `\u2705 ${who(u)}: \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 \u0434\u043E ${fmt(u.subscriptionUntil)}` + (u.planId ? ` (\u0442\u0430\u0440\u0438\u0444 ${u.planId})` : ""));
    await notify(u.tgId, `\u2705 \u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 Fracs \u0430\u043A\u0442\u0438\u0432\u043D\u0430 \u0434\u043E ${fmt(u.subscriptionUntil)}. \u041A\u0430\u0431\u0438\u043D\u0435\u0442: ${config.appUrl}/app`);
  } else if (cmd === "/granttokens") {
    const arg = (args[1] || "").trim().toLowerCase();
    const pack = loadTokenPacks().find((p) => p.id.toLowerCase() === arg);
    let tokens = pack ? pack.tokens : 0;
    if (!tokens && arg) {
      const mShort = arg.match(/^(\d+(?:[.,]\d+)?)\s*([kmкм])$/i);
      if (mShort) {
        const mult = /[mм]/i.test(mShort[2]) ? 1e6 : 1e3;
        tokens = Math.round(Number(mShort[1].replace(",", ".")) * mult);
      } else {
        tokens = Math.round(Number(arg.replace(/[\s_]/g, "")));
      }
    }
    if (!Number.isFinite(tokens) || tokens < 1 || tokens > 5e7) {
      const packList = loadTokenPacks().map((p) => `${p.id} (${p.tokens.toLocaleString("ru-RU")})`).join(", ");
      await notify(chatId, `\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0438\u0435: /granttokens <@username|id|email> <\u0447\u0438\u0441\u043B\u043E|packId>
\u041F\u0430\u043A\u0435\u0442\u044B: ${packList}
\u041F\u0440\u0438\u043C\u0435\u0440: /granttokens ${args[0]} 500000`);
      return true;
    }
    await aiTokensAdd(user.id, tokens);
    await Promise.all([
      refundBudgetWindow(`ai-cx-day:${user.id}`, 1e4),
      refundBudgetWindow(`ai-phrase-day:${user.id}`, 1e4)
    ]).catch(() => {
    });
    const bal = await aiTokensGet(user.id).catch(() => tokens);
    await notify(chatId, `\u26A1\uFE0F ${who(user)}: +${tokens.toLocaleString("ru-RU")} \u0442\u043E\u043A\u0435\u043D\u043E\u0432 Fracs AI (\u0431\u0430\u043B\u0430\u043D\u0441: ${bal.toLocaleString("ru-RU")})`);
    await notify(user.tgId, `\u26A1\uFE0F \u041B\u0438\u043C\u0438\u0442\u044B Fracs AI \u043F\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u044B: +${tokens.toLocaleString("ru-RU")} \u0442\u043E\u043A\u0435\u043D\u043E\u0432 (\u0431\u0430\u043B\u0430\u043D\u0441: ${bal.toLocaleString("ru-RU")}). \u041A\u0430\u0431\u0438\u043D\u0435\u0442: ${config.appUrl}/app`);
  } else if (cmd === "/revoke") {
    const u = await setSubscription(user.id, null);
    await notify(chatId, `\u{1F6AB} ${who(u)}: \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 \u0441\u043D\u044F\u0442\u0430`);
  }
  return true;
}
async function handleLoginConfirm(cb) {
  const data = cb.data || "";
  const chatId = cb.message?.chat?.id;
  const cbId = String(cb.id || "");
  if (!chatId) {
    await answerCb(cbId);
    return;
  }
  if (data === "lt:no") {
    await editMsg(chatId, cb.message?.message_id, "\u{1F6E1} \u0412\u0445\u043E\u0434 \u043E\u0442\u043C\u0435\u043D\u0451\u043D. \u0415\u0441\u043B\u0438 \u0432\u044B \u043D\u0435 \u0438\u043D\u0438\u0446\u0438\u0438\u0440\u043E\u0432\u0430\u043B\u0438 \u0432\u0445\u043E\u0434 \u2014 \u043D\u0438\u043A\u0442\u043E \u043D\u0435 \u043F\u043E\u043B\u0443\u0447\u0438\u043B \u0434\u043E\u0441\u0442\u0443\u043F \u043A \u0432\u0430\u0448\u0435\u043C\u0443 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0443.", { reply_markup: { inline_keyboard: [] } });
    await answerCb(cbId, "\u0412\u0445\u043E\u0434 \u043E\u0442\u043C\u0435\u043D\u0451\u043D");
    return;
  }
  const token = data.startsWith("lt:ok:") ? data.slice(6) : "";
  const user = await upsertTgUser(cb.from);
  if (!await checkChannelSubs(user.tgId)) {
    await notify(chatId, SUBS_GATE_TEXT, { reply_markup: await subsGateKb("login", token) });
    await answerCb(cbId);
    return;
  }
  await finalizeStart(chatId, user, "login", token);
  if (cb.message?.message_id) {
    await editMsg(chatId, cb.message.message_id, "\u2705 \u0412\u0445\u043E\u0434 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043D! \u0412\u0435\u0440\u043D\u0438\u0442\u0435\u0441\u044C \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440.", { reply_markup: { inline_keyboard: [] } });
  }
  await answerCb(cbId, "\u0412\u0445\u043E\u0434 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043D");
}
async function handleSubCallback(cb) {
  const data = cb.data || "";
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  const cbId = cb.id;
  if (!chatId) {
    await answerCb(cbId);
    return;
  }
  if (data === "sub:nop") {
    await answerCb(cbId, "\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043A\u0430\u043D\u0430\u043B \u0438 \u043F\u043E\u0434\u043F\u0438\u0448\u0438\u0442\u0435\u0441\u044C, \u0437\u0430\u0442\u0435\u043C \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C\xBB");
    return;
  }
  if (!data.startsWith("sub:check")) {
    await answerCb(cbId);
    return;
  }
  const user = await upsertTgUser(cb.from);
  const ok = await checkChannelSubs(user.tgId);
  if (!ok) {
    await answerCb(cbId, "\u0415\u0449\u0451 \u043D\u0435 \u043F\u043E\u0434\u043F\u0438\u0441\u0430\u043D\u044B \u043D\u0430 \u0432\u0441\u0435 \u043A\u0430\u043D\u0430\u043B\u044B", true);
    return;
  }
  await answerCb(cbId, "\u2705 \u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0438 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u044B");
  const m = data.match(/^sub:check:lt:(.+)$/);
  const intent = m ? "login" : "ref";
  const param = m ? m[1] : "";
  if (messageId) await tg("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => {
  });
  if (intent === "login") {
    await notify(
      chatId,
      `\u{1F511} \u0412\u044B \u0432\u0445\u043E\u0434\u0438\u0442\u0435 \u043D\u0430 \u0441\u0430\u0439\u0442 Fracs \u043F\u043E \u0441\u0441\u044B\u043B\u043A\u0435 \u0438\u0437 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430.

\u0415\u0441\u043B\u0438 \u044D\u0442\u043E \u0412\u042B \u2014 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u0432\u0445\u043E\u0434.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "\u2705 \u042D\u0442\u043E \u044F \u2014 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C \u0432\u0445\u043E\u0434", callback_data: `lt:ok:${param}` }],
            [{ text: "\u274C \u042D\u0442\u043E \u043D\u0435 \u044F \u2014 \u043E\u0442\u043C\u0435\u043D\u0438\u0442\u044C", callback_data: "lt:no" }]
          ]
        }
      }
    );
    return;
  }
  await finalizeStart(chatId, user, intent, param);
}
async function handleUpdate(update) {
  const cb = update?.callback_query;
  if (cb) {
    const cbData = String(cb.data || "");
    if (config.adminTgId > 0 && cb.from?.id === config.adminTgId && cbData.startsWith("adm:")) {
      try {
        await handleAdminCallback(cb);
      } catch (e) {
        console.error("[bot] admin cb", e);
        await tg("answerCallbackQuery", { callback_query_id: cb.id, text: `\u041E\u0448\u0438\u0431\u043A\u0430: ${e?.message || e}`, show_alert: true }).catch(() => {
        });
      }
      return;
    }
    if ((cb.data || "").startsWith("sub:")) {
      try {
        await handleSubCallback(cb);
      } catch (e) {
        console.error("[bot] sub cb", e);
        await tg("answerCallbackQuery", { callback_query_id: cb.id, text: `\u041E\u0448\u0438\u0431\u043A\u0430: ${e?.message || e}`, show_alert: true }).catch(() => {
        });
      }
      return;
    }
    if ((cb.data || "").startsWith("lt:")) {
      try {
        await handleLoginConfirm(cb);
      } catch (e) {
        console.error("[bot] login cb", e);
        await tg("answerCallbackQuery", { callback_query_id: cb.id, text: `\u041E\u0448\u0438\u0431\u043A\u0430: ${e?.message || e}`, show_alert: true }).catch(() => {
        });
      }
      return;
    }
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "\u041D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u0430" }).catch(() => {
    });
    return;
  }
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
  if (cmd === "/start" && param) {
    const intent = param.startsWith("ref_") ? "ref" : "login";
    const user = await upsertTgUser(msg.from);
    const subscribed = await checkChannelSubs(user.tgId);
    if (intent === "login") {
      if (!subscribed) {
        await notify(msg.chat.id, SUBS_GATE_TEXT, { reply_markup: await subsGateKb("login", param) });
        return;
      }
      await notify(
        msg.chat.id,
        `\u{1F511} \u0412\u044B \u0432\u0445\u043E\u0434\u0438\u0442\u0435 \u043D\u0430 \u0441\u0430\u0439\u0442 Fracs \u043F\u043E \u0441\u0441\u044B\u043B\u043A\u0435 \u0438\u0437 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430.

\u0415\u0441\u043B\u0438 \u044D\u0442\u043E \u0412\u042B \u0438 \u0432\u044B \u043D\u0430\u0436\u0438\u043C\u0430\u043B\u0438 \xAB\u0412\u043E\u0439\u0442\u0438 \u0447\u0435\u0440\u0435\u0437 Telegram\xBB \u043D\u0430 \u0441\u0430\u0439\u0442\u0435 \u2014 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u0432\u0445\u043E\u0434. \u0415\u0441\u043B\u0438 \u043D\u0435\u0442: \u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E, \u043A\u0442\u043E-\u0442\u043E \u043F\u044B\u0442\u0430\u0435\u0442\u0441\u044F \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0434\u043E\u0441\u0442\u0443\u043F \u043A \u0432\u0430\u0448\u0435\u043C\u0443 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0443 \u2014 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C\xBB.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "\u2705 \u042D\u0442\u043E \u044F \u2014 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C \u0432\u0445\u043E\u0434", callback_data: `lt:ok:${param}` }],
              [{ text: "\u274C \u042D\u0442\u043E \u043D\u0435 \u044F \u2014 \u043E\u0442\u043C\u0435\u043D\u0438\u0442\u044C", callback_data: "lt:no" }]
            ]
          }
        }
      );
      return;
    }
    if (subscribed) {
      await finalizeStart(msg.chat.id, user, intent, "");
    } else {
      await notify(msg.chat.id, SUBS_GATE_TEXT, { reply_markup: await subsGateKb("ref", "") });
    }
    return;
  }
  if (!await checkChannelSubs(msg.from.id)) {
    await notify(msg.chat.id, SUBS_GATE_TEXT, { reply_markup: await subsGateKb("ref", "") });
    return;
  }
  if (cmd === "/privacy") {
    await notify(msg.chat.id, `\u{1F512} \u041F\u043E\u043B\u0438\u0442\u0438\u043A\u0430 \u043A\u043E\u043D\u0444\u0438\u0434\u0435\u043D\u0446\u0438\u0430\u043B\u044C\u043D\u043E\u0441\u0442\u0438 Fracs:
${base}/privacy`, { reply_markup: docsMarkup(false) });
    return;
  }
  if (cmd === "/terms") {
    await notify(msg.chat.id, `\u{1F4C4} \u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C\u0441\u043A\u043E\u0435 \u0441\u043E\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u0435 Fracs:
${base}/terms`, { reply_markup: docsMarkup(false) });
    return;
  }
  if (cmd === "/offer") {
    await notify(msg.chat.id, `\u{1F4D1} \u041F\u0443\u0431\u043B\u0438\u0447\u043D\u0430\u044F \u043E\u0444\u0435\u0440\u0442\u0430 Fracs:
${base}/offer`, { reply_markup: docsMarkup(false) });
    return;
  }
  if (cmd === "/docs") {
    await notify(msg.chat.id, "\u041F\u0440\u0430\u0432\u043E\u0432\u044B\u0435 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u044B \u0441\u0435\u0440\u0432\u0438\u0441\u0430 Fracs:", { reply_markup: docsMarkup(true) });
    return;
  }
  if (cmd !== "/start") {
    await notify(msg.chat.id, `\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043B\u0438\u0447\u043D\u044B\u0439 \u043A\u0430\u0431\u0438\u043D\u0435\u0442: ${base}/app`, { reply_markup: docsMarkup(true) });
    return;
  }
  await notify(
    msg.chat.id,
    `\u041F\u0440\u0438\u0432\u0435\u0442! \u042D\u0442\u043E \u0431\u043E\u0442 Fracs.

\u0427\u0442\u043E\u0431\u044B \u0432\u043E\u0439\u0442\u0438, \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u0412\u043E\u0439\u0442\u0438 \u0447\u0435\u0440\u0435\u0437 Telegram\xBB \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435 ${base}/app.

\u041F\u0435\u0440\u0435\u0434 \u043D\u0430\u0447\u0430\u043B\u043E\u043C \u0440\u0430\u0431\u043E\u0442\u044B \u0432\u044B \u043C\u043E\u0436\u0435\u0442\u0435 \u043E\u0437\u043D\u0430\u043A\u043E\u043C\u0438\u0442\u044C\u0441\u044F \u0441 \u043F\u0440\u0430\u0432\u043E\u0432\u044B\u043C\u0438 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430\u043C\u0438 \u043F\u043E \u043A\u043D\u043E\u043F\u043A\u0430\u043C \u043D\u0438\u0436\u0435:`,
    { reply_markup: docsMarkup(true) }
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
var webhookEnsured = false;
async function ensureWebhook() {
  if (webhookEnsured || !config.botToken || config.botMode !== "webhook") return;
  webhookEnsured = true;
  try {
    if (!config.webhookSecret) throw new Error("\u0414\u043B\u044F webhook-\u0440\u0435\u0436\u0438\u043C\u0430 \u0437\u0430\u0434\u0430\u0439\u0442\u0435 TELEGRAM_WEBHOOK_SECRET");
    const me = await tg("getMe");
    if (!me.ok) throw new Error(`Telegram getMe: ${me.description}`);
    if (!botUsername) botUsername = me.result.username;
    const r = await tg("setWebhook", {
      url: `${config.appUrl}/api/bot/webhook`,
      secret_token: config.webhookSecret,
      allowed_updates: ["message", "callback_query"]
    });
    if (!r.ok) throw new Error(`setWebhook: ${r.description}`);
    console.log(`[bot] webhook \u043F\u0440\u043E\u0432\u0435\u0440\u0435\u043D/\u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D: ${config.appUrl}/api/bot/webhook`);
  } catch (e) {
    console.error("[bot] ensureWebhook:", e?.message || e);
  }
}

// server/auth.ts
var COOKIE = "fracs_session";
var SESSION_MS = 30 * 864e5;
var sign = (p) => crypto4.createHmac("sha256", config.sessionSecret).update("session:" + p).digest("base64url");
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
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
    }
  }
  return out;
}
function cookieOpts(req) {
  const secure = req.secure || req.get("x-forwarded-proto") === "https" || config.isProd;
  const sameSite = secure && process.env.COOKIE_SAMESITE !== "Lax" ? "None" : "Lax";
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
async function requireAuth(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized", message: "\u0412\u043E\u0439\u0434\u0438\u0442\u0435 \u0447\u0435\u0440\u0435\u0437 Telegram \u0438\u043B\u0438 email" });
    return;
  }
  if (req.user.tgId != null && !await checkChannelSubs(req.user.tgId)) {
    res.status(403).json({ error: "channels_required", message: "\u041F\u043E\u0434\u043F\u0438\u0448\u0438\u0442\u0435\u0441\u044C \u043D\u0430 \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u043A\u0430\u043D\u0430\u043B\u044B \u0432 \u0431\u043E\u0442\u0435 Fracs, \u0447\u0442\u043E\u0431\u044B \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C." });
    return;
  }
  next();
}
var h = (fn) => (req, res, next) => {
  fn(req, res).catch(next);
};
var authRouter = Router();
authRouter.post("/start", h(async (req, res) => {
  if (!await rateLimit(`auth:${req.ip}`, 20, 10 * 6e4, true)) return void res.status(429).json({ error: "rate_limited" });
  const username = await getBotUsername();
  if (!username) {
    return void res.status(503).json({
      error: "bot_not_configured",
      message: "\u0411\u043E\u0442 \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D \u043D\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0435: \u043F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 TELEGRAM_BOT_TOKEN \u0438 TELEGRAM_BOT_USERNAME"
    });
  }
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
authRouter.post("/logout", (req, res) => {
  const { secure, sameSite } = cookieOpts(req);
  res.append("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0${secure ? "; Secure" : ""}`);
  res.json({ ok: true });
});
var EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
var CODE_RE = /^\d{6,8}$/;
var normalizeEmail = (raw) => raw.trim().toLowerCase();
var OTP_TTL_MS = 10 * 6e4;
var localOtps = /* @__PURE__ */ new Map();
var hashOtp = (email, code) => crypto4.createHmac("sha256", config.sessionSecret).update(`email-otp:${email}:${code}`).digest("hex");
function issueLocalOtp(email) {
  const now = Date.now();
  for (const [k, v] of localOtps) if (v.expiresAt < now) localOtps.delete(k);
  const code = String(crypto4.randomInt(1e5, 1e6));
  localOtps.set(email, { hash: hashOtp(email, code), expiresAt: now + OTP_TTL_MS, attempts: 0 });
  return code;
}
function verifyLocalOtp(email, code) {
  const entry = localOtps.get(email);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt || entry.attempts >= 5) {
    localOtps.delete(email);
    return false;
  }
  entry.attempts++;
  const expected = hashOtp(email, code);
  const a = Buffer.from(entry.hash);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && crypto4.timingSafeEqual(a, b);
  if (ok || entry.attempts >= 5) localOtps.delete(email);
  return ok;
}
var supabaseEmailReady = () => Boolean(config.supabaseUrl && config.supabaseKey);
function supabaseAuthHeaders() {
  return {
    apikey: config.supabaseKey,
    Authorization: `Bearer ${config.supabaseKey}`,
    "Content-Type": "application/json"
  };
}
async function resendSendOtp(email, code) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: config.resendFrom,
      to: [email],
      subject: `\u041A\u043E\u0434 \u0434\u043B\u044F \u0432\u0445\u043E\u0434\u0430 \u0432 Fracs: ${code}`,
      html: `<div style="font-family:sans-serif;background:#0a0a0a;color:#fff;padding:32px;border-radius:16px;max-width:480px;margin:0 auto">
        <h2 style="margin:0 0 12px;color:#fff">\u0412\u0445\u043E\u0434 \u0432 Fracs</h2>
        <p style="margin:0 0 20px;color:#ccc">\u0412\u0430\u0448 \u043E\u0434\u043D\u043E\u0440\u0430\u0437\u043E\u0432\u044B\u0439 \u043A\u043E\u0434 \u0434\u043B\u044F \u0432\u0445\u043E\u0434\u0430 (\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0442\u0435\u043B\u0435\u043D 10 \u043C\u0438\u043D\u0443\u0442):</p>
        <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#F26522;background:#141414;padding:16px 24px;border-radius:12px;text-align:center;border:1px solid #F26522">${code}</div>
      </div>`
    }),
    signal: AbortSignal.timeout(1e4)
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body?.message || `resend_${r.status}`);
  }
}
async function supabaseOtpStart(email) {
  const r = await fetch(`${config.supabaseUrl}/auth/v1/otp`, {
    method: "POST",
    headers: supabaseAuthHeaders(),
    body: JSON.stringify({ email, create_user: true }),
    signal: AbortSignal.timeout(1e4)
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    const msg = body?.error_description || body?.msg || body?.message || `supabase_${r.status}`;
    const isRate = r.status === 429 || body?.error_code === "over_email_send_rate_limit";
    throw Object.assign(new Error(msg), { code: isRate ? "email_rate_limited" : "email_start_failed" });
  }
}
async function supabaseOtpVerify(email, code) {
  const r = await fetch(`${config.supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: supabaseAuthHeaders(),
    body: JSON.stringify({ type: "email", email, token: code }),
    signal: AbortSignal.timeout(1e4)
  });
  return r.ok;
}
authRouter.post("/email/start", h(async (req, res) => {
  const email = normalizeEmail(String(req.body?.email || ""));
  if (!EMAIL_RE.test(email)) return void res.status(400).json({ error: "bad_email", message: "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 \u0430\u0434\u0440\u0435\u0441 \u044D\u043B. \u043F\u043E\u0447\u0442\u044B" });
  if (!await rateLimit(`auth-email-ip:${req.ip}`, 10, 10 * 6e4, true)) return void res.status(429).json({ error: "rate_limited" });
  if (!await rateLimit(`auth-email-addr:${email}`, 5, 30 * 6e4, true)) return void res.status(429).json({ error: "rate_limited", message: "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u0447\u0430\u0441\u0442\u043E. \u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435 \u043D\u0435\u043C\u043D\u043E\u0433\u043E \u2014 \u043A\u043E\u0434 \u0443\u0436\u0435 \u043B\u0435\u0442\u0438\u0442." });
  if (config.resendApiKey) {
    const code = issueLocalOtp(email);
    try {
      await resendSendOtp(email, code);
      return void res.json({ ok: true, email });
    } catch (e) {
      localOtps.delete(email);
      console.warn("[auth] email/start resend:", e?.message);
      return void res.status(502).json({ error: "email_start_failed", message: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u043A\u043E\u0434. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435." });
    }
  }
  if (supabaseEmailReady()) {
    try {
      await supabaseOtpStart(email);
      return void res.json({ ok: true, email });
    } catch (e) {
      if (e?.code === "email_rate_limited") return void res.status(429).json({ error: "rate_limited", message: "\u041F\u0438\u0441\u044C\u043C\u043E \u0443\u0436\u0435 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E. \u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435 \u043C\u0438\u043D\u0443\u0442\u0443 \u043F\u0435\u0440\u0435\u0434 \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u043E\u0439 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u043E\u0439." });
      console.warn("[auth] email/start supabase:", e?.message);
      return void res.status(502).json({ error: "email_start_failed", message: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u043A\u043E\u0434. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u043F\u043E\u0447\u0442\u044B \u0438\u043B\u0438 \u0432\u043E\u0439\u0434\u0438\u0442\u0435 \u0447\u0435\u0440\u0435\u0437 Telegram." });
    }
  }
  return void res.status(503).json({ error: "email_auth_unavailable", message: "\u041E\u0442\u043F\u0440\u0430\u0432\u043A\u0430 \u043F\u043E\u0447\u0442\u044B \u043D\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0435 \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u0430. \u0412\u043E\u0439\u0434\u0438\u0442\u0435 \u0447\u0435\u0440\u0435\u0437 Telegram \u0438\u043B\u0438 \u0437\u0430\u0434\u0430\u0439\u0442\u0435 RESEND_API_KEY / SUPABASE_URL." });
}));
authRouter.post("/email/verify", h(async (req, res) => {
  const email = normalizeEmail(String(req.body?.email || ""));
  const code = String(req.body?.code || "").replace(/\D/g, "");
  if (!EMAIL_RE.test(email)) return void res.status(400).json({ error: "bad_email", message: "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 \u0430\u0434\u0440\u0435\u0441 \u044D\u043B. \u043F\u043E\u0447\u0442\u044B" });
  if (!CODE_RE.test(code)) return void res.status(400).json({ error: "bad_code", message: "\u041A\u043E\u0434 \u2014 6\u20138 \u0446\u0438\u0444\u0440 \u0438\u0437 \u043F\u0438\u0441\u044C\u043C\u0430" });
  if (!await rateLimit(`auth-email-verify:${req.ip}:${email}`, 8, 10 * 6e4, true)) return void res.status(429).json({ error: "rate_limited", message: "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u043C\u043D\u043E\u0433\u043E \u043F\u043E\u043F\u044B\u0442\u043E\u043A. \u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435 10 \u043C\u0438\u043D\u0443\u0442." });
  let ok = verifyLocalOtp(email, code);
  if (!ok && supabaseEmailReady()) {
    try {
      ok = await supabaseOtpVerify(email, code);
    } catch (e) {
      console.warn("[auth] email/verify supabase:", e);
    }
  }
  if (!ok) return void res.status(400).json({ error: "bad_code", message: "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u0438\u043B\u0438 \u0443\u0441\u0442\u0430\u0440\u0435\u0432\u0448\u0438\u0439 \u043A\u043E\u0434" });
  const user = await upsertEmailUser(email);
  setSession(req, res, user.id);
  res.json({ ok: true });
}));

// server/appRoutes.ts
import crypto6 from "node:crypto";
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
function searchCities(q, limit2 = 8) {
  const base = norm(q);
  const out = (cs) => cs.slice(0, limit2).map(({ id, name, region }) => ({ id, name, region }));
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
var isAgg = (h5) => AGG.some((d) => h5 === d || h5.endsWith("." + d));
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
    const h5 = norm2(t);
    return h5.includes(norm2(c.name)) || toks.filter((x) => h5.includes(x)).length >= need;
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
function getRows(rec, offset, limit2) {
  if (!rec.demo) return (rec.rows ?? []).slice(offset, offset + limit2);
  const out = [];
  for (let i = offset; i < Math.min(offset + limit2, rec.rowsTotal); i++) out.push(rec.kind === "maps" ? demoMapsRow(rec, i) : demoTgRow(rec, i));
  return out;
}
var headRows = (rec) => rec.demo ? getRows(rec, 0, 3) : rec.head ?? [];

// server/payments.ts
import crypto5 from "node:crypto";
var CRYPTOBOT_API = "https://pay.crypt.bot/api";
var XROCKET_API = "https://pay.xrocket.tg";
var XROCKET_PAY_API = "https://pay.api.xrocket.exchange";
function xrocketMode() {
  if (config.xrocketApi !== "auto") return config.xrocketApi;
  return config.xrocketKey.startsWith("eyJ") ? "pay" : "legacy";
}
function keyInfo() {
  const k = process.env.XROCKET_API_KEY || "";
  return {
    mode: xrocketMode(),
    len: config.xrocketKey.length,
    looksJwt: config.xrocketKey.startsWith("eyJ"),
    rawHadQuotesOrSpaces: k !== config.xrocketKey,
    hasInnerWhitespace: /\s/.test(config.xrocketKey),
    hasBearerPrefix: /^bearer\s/i.test(config.xrocketKey)
  };
}
async function activate(p) {
  const [user, plans] = await Promise.all([getUser(p.userId), getPlans()]);
  const pack = loadTokenPacks().find((t) => t.id === p.planId);
  if (pack) {
    if (!user) return;
    if (!await claimPayment(p.id)) return;
    try {
      await aiTokensAdd(user.id, pack.tokens);
      await notify(user.tgId, `\u26A1\uFE0F \u0422\u043E\u043A\u0435\u043D\u044B Fracs AI \u0437\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u044B: +${pack.tokens.toLocaleString("ru-RU")}. \u0411\u0430\u043B\u0430\u043D\u0441 \u043D\u0435 \u0438\u0441\u0442\u0435\u043A\u0430\u0435\u0442 \u2014 \u0441\u043C\u043E\u0442\u0440\u0438\u0442\u0435 \u043E\u0441\u0442\u0430\u0442\u043E\u043A \u0432 \u043A\u0430\u0431\u0438\u043D\u0435\u0442\u0435: ${config.appUrl}/app`);
    } catch (e) {
      await revertPayment(p.id);
      throw e;
    }
    return;
  }
  const plan = plans.find((x) => x.id === p.planId);
  if (!user || !plan) return;
  if (!await claimPayment(p.id)) return;
  try {
    const updated = await extendSubscription(user.id, plan.days, plan.id);
    await notify(user.tgId, `\u2705 \u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 \u0430\u043A\u0442\u0438\u0432\u043D\u0430 \u0434\u043E ${new Date(updated.subscriptionUntil).toLocaleDateString("ru-RU")}. \u0414\u0430\u043D\u043D\u044B\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u044B \u0432 \u043A\u0430\u0431\u0438\u043D\u0435\u0442\u0435: ${config.appUrl}/app`);
  } catch (e) {
    await revertPayment(p.id);
    throw e;
  }
}
async function getUsdtRubRate() {
  try {
    const r = await fetch("https://api.coinbase.com/v2/exchange-rates?currency=USDT", {
      signal: AbortSignal.timeout(2500)
    });
    if (r.ok) {
      const j = await r.json();
      const rub = Number(j?.data?.rates?.RUB);
      if (Number.isFinite(rub) && rub > 20 && rub < 500) return rub;
    }
  } catch {
  }
  return Number.isFinite(config.usdtRubRate) && config.usdtRubRate > 0 ? config.usdtRubRate : 95;
}
async function createPayment(user, planId, method, promoCode) {
  const pack = loadTokenPacks().find((t) => t.id === planId);
  const plans = pack ? [] : await getPlans();
  const plan = pack ? void 0 : plans.find((p) => p.id === planId);
  if (!pack && !plan) throw Object.assign(new Error("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0439 \u0442\u0430\u0440\u0438\u0444"), { status: 400 });
  const chosen = method === "cryptobot" || method === "xrocket" ? method : config.paymentProvider;
  let amountRub = pack ? pack.priceRub : plan.priceRub;
  let promo = null;
  if (promoCode) {
    promo = await findActivePromoCode(promoCode);
    if (!promo) throw Object.assign(new Error("\u041F\u0440\u043E\u043C\u043E\u043A\u043E\u0434 \u043D\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0442\u0435\u043B\u0435\u043D \u0438\u043B\u0438 \u0438\u0441\u0447\u0435\u0440\u043F\u0430\u043D"), { status: 400 });
    amountRub = Math.max(1, Math.round(amountRub * (1 - promo.discountPercent / 100)));
  }
  const title = pack ? `\u0422\u043E\u043A\u0435\u043D\u044B Fracs AI: ${pack.title}` : `\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 Fracs: ${plan.title}`;
  const rec = {
    id: newId(),
    userId: user.id,
    planId: (pack ?? plan).id,
    amountRub,
    status: "pending",
    provider: chosen,
    providerId: null,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    paidAt: null
  };
  await insertPayment(rec);
  if (promo) await incrementPromoUse(promo.id);
  const returnUrl = config.appUrl.startsWith("https://") ? `${config.appUrl}/app?paid=1` : void 0;
  if (chosen === "cryptobot") {
    if (!config.cryptobotToken) {
      throw Object.assign(new Error("\u041E\u043F\u043B\u0430\u0442\u0430 \u0447\u0435\u0440\u0435\u0437 CryptoBot \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u0430. \u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \xAB\u0420\u0435\u043A\u0432\u0438\u0437\u0438\u0442\u044B\xBB \u0434\u043B\u044F \u043E\u043F\u043B\u0430\u0442\u044B \u0447\u0435\u0440\u0435\u0437 @HelpManage."), { status: 503 });
    }
    const resp2 = await fetch(`${CRYPTOBOT_API}/createInvoice`, {
      method: "POST",
      headers: {
        "Crypto-Pay-API-Token": config.cryptobotToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        currency_type: "fiat",
        fiat: "RUB",
        amount: String(amountRub),
        accepted_assets: "USDT,TON,BTC,ETH,LTC,BNB,TRX,USDC",
        description: title,
        payload: rec.id,
        ...returnUrl ? { paid_btn_name: "callback", paid_btn_url: returnUrl } : {}
      }),
      signal: AbortSignal.timeout(15e3)
    });
    const json2 = await resp2.json().catch(() => ({}));
    if (!resp2.ok || !json2?.ok || !json2?.result) {
      const msg = String(json2?.error?.name || resp2.status);
      throw Object.assign(
        new Error(
          resp2.status === 401 || /UNAUTHORIZED/i.test(msg) ? "CryptoBot \u043E\u0442\u043A\u043B\u043E\u043D\u0438\u043B \u0442\u043E\u043A\u0435\u043D (\u043F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 CRYPTOBOT_API_TOKEN \u043D\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0435)." : `\u041E\u0448\u0438\u0431\u043A\u0430 CryptoBot: ${msg}`
        ),
        { status: 502 }
      );
    }
    await setPaymentProviderId(rec.id, String(json2.result.invoice_id));
    const confirmationUrl = json2.result.bot_invoice_url || json2.result.web_app_invoice_url || json2.result.mini_app_invoice_url;
    return { paymentId: rec.id, confirmationUrl };
  }
  if (!config.xrocketKey) {
    throw Object.assign(new Error("\u041E\u043F\u043B\u0430\u0442\u0430 \u0447\u0435\u0440\u0435\u0437 xRocket \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u0430. \u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \xAB\u0420\u0435\u043A\u0432\u0438\u0437\u0438\u0442\u044B\xBB \u0434\u043B\u044F \u043E\u043F\u043B\u0430\u0442\u044B \u0447\u0435\u0440\u0435\u0437 @HelpManage."), { status: 503 });
  }
  const rate = await getUsdtRubRate();
  const usdtAmount = Math.max(0.1, Math.round(amountRub / rate * 100) / 100);
  const description = `${title} (${amountRub} \u20BD)`;
  const mode = xrocketMode();
  const resp = mode === "pay" ? await fetch(`${XROCKET_PAY_API}/api/v1/invoices`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.xrocketKey.replace(/^bearer\s+/i, "")}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    // Pay API: суммы — строки, ответ без обёртки success/data.
    body: JSON.stringify({
      priceAmount: usdtAmount.toFixed(2),
      priceCurrency: "USDT",
      clientInvoiceId: rec.id,
      description,
      callback: { payload: { paymentId: rec.id } },
      ...returnUrl ? { url: { successUrl: returnUrl } } : {}
    }),
    signal: AbortSignal.timeout(15e3)
  }) : await fetch(`${XROCKET_API}/tg-invoices`, {
    method: "POST",
    headers: { "Rocket-Pay-Key": config.xrocketKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: usdtAmount,
      numPayments: 1,
      currency: "USDT",
      description,
      commentsEnabled: false,
      ...returnUrl ? { callbackUrl: returnUrl } : {},
      payload: rec.id
    }),
    signal: AbortSignal.timeout(15e3)
  });
  const rawText = await resp.text().catch(() => "");
  let json = {};
  try {
    json = JSON.parse(rawText);
  } catch {
  }
  const link = mode === "pay" ? json?.links?.telegramBotLink || json?.links?.webLink || json?.links?.telegramMiniAppLink : json?.success ? json?.data?.link : void 0;
  const invoiceId = mode === "pay" ? json?.id : json?.data?.id;
  if (!resp.ok || !link || invoiceId == null) {
    console.error("[pay][xrocket] create failed", {
      status: resp.status,
      contentType: resp.headers.get("content-type"),
      cfRay: resp.headers.get("cf-ray"),
      body: rawText.slice(0, 500),
      key: keyInfo()
    });
    const errMsg = mode === "pay" ? String(json?.detail || json?.title || json?.type || resp.status) : Array.isArray(json?.message) ? json.message.join("; ") : String(json?.message || (json?.errors ? JSON.stringify(json.errors) : resp.status));
    const isJson = Boolean(rawText) && Object.keys(json).length > 0;
    const hint = mode === "pay" ? "\u043D\u0443\u0436\u0435\u043D Bearer-\u0442\u043E\u043A\u0435\u043D Pay API (@xRocket \u2192 Pay API \u2192 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u2192 Settings \u2192 API Token), \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0434\u043E\u043B\u0436\u043D\u043E \u0431\u044B\u0442\u044C \u043D\u0430 API Version \xABCurrent\xBB" : "\u043D\u0443\u0436\u0435\u043D \u043A\u043B\u044E\u0447 Legacy API; \u0442\u043E\u043A\u0435\u043D \u043D\u043E\u0432\u043E\u0433\u043E Pay API (\u043D\u0430\u0447\u0438\u043D\u0430\u0435\u0442\u0441\u044F \u0441 eyJ) \u0441\u044E\u0434\u0430 \u043D\u0435 \u043F\u043E\u0434\u0445\u043E\u0434\u0438\u0442 \u2014 \u0437\u0430\u0434\u0430\u0439\u0442\u0435 XROCKET_API_VERSION=pay";
    throw Object.assign(
      new Error(
        resp.status === 401 ? `xRocket \u043E\u0442\u043A\u043B\u043E\u043D\u0438\u043B \u043A\u043B\u044E\u0447 (401, \u0440\u0435\u0436\u0438\u043C ${mode}): ${hint}.` : resp.status === 403 && !isJson ? `xRocket \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0441 \u0441\u0435\u0440\u0432\u0435\u0440\u0430 (403, \u043E\u0442\u0432\u0435\u0442 \u043D\u0435 JSON \u2014 \u043F\u043E\u0445\u043E\u0436\u0435 \u043D\u0430 \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0443 WAF/IP), \u0441\u043C. \u043B\u043E\u0433\u0438 Vercel.` : `\u041E\u0448\u0438\u0431\u043A\u0430 xRocket (${resp.status}, \u0440\u0435\u0436\u0438\u043C ${mode}): ${errMsg}`
      ),
      { status: 502 }
    );
  }
  await setPaymentProviderId(rec.id, String(invoiceId));
  return { paymentId: rec.id, confirmationUrl: String(link) };
}
function verifyCryptoBotSig(rawBody, signature) {
  if (!config.cryptobotToken || !rawBody || !signature) return false;
  const secret = crypto5.createHash("sha256").update(config.cryptobotToken).digest();
  const expected = crypto5.createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(expected, signature.toLowerCase());
}
async function handleCryptoBotWebhook(body, rawBody, signature = "") {
  if (!verifyCryptoBotSig(rawBody, signature)) return;
  if (body?.update_type !== "invoice_paid") return;
  const inv = body?.payload;
  const invoiceId = inv?.invoice_id;
  if (invoiceId == null) return;
  const rec = await findPaymentByProviderId(String(invoiceId));
  if (!rec || rec.status !== "pending") return;
  const checkResp = await fetch(`${CRYPTOBOT_API}/getInvoices`, {
    method: "POST",
    headers: { "Crypto-Pay-API-Token": config.cryptobotToken, "Content-Type": "application/json" },
    body: JSON.stringify({ invoice_ids: String(invoiceId) }),
    signal: AbortSignal.timeout(15e3)
  });
  if (!checkResp.ok) return;
  const checkJson = await checkResp.json().catch(() => ({}));
  const real = checkJson?.result?.items?.[0];
  if (real?.status === "paid" && String(real.payload || "") === rec.id) {
    await activate(rec);
  }
}
function verifyXRocketSig(rawBody, headers) {
  if (!rawBody) return false;
  const legacySig = (headers.legacySig || "").trim();
  const signature = (headers.signature || "").trim();
  const timestamp = (headers.timestamp || "").trim();
  if (config.xrocketWebhookToken && signature && timestamp) {
    const tsNum = Number(timestamp);
    if (!Number.isFinite(tsNum)) return false;
    const tsSec = tsNum > 1e12 ? tsNum / 1e3 : tsNum;
    if (Math.abs(Date.now() / 1e3 - tsSec) > 300) return false;
    const payload = `${timestamp}.${rawBody.toString("utf8")}`;
    const hmacHex = crypto5.createHmac("sha256", config.xrocketWebhookToken).update(payload, "utf8").digest("hex");
    const hmacB64 = crypto5.createHmac("sha256", config.xrocketWebhookToken).update(payload, "utf8").digest("base64");
    if (safeEqual(hmacHex, signature.toLowerCase()) || safeEqual(hmacB64, signature)) return true;
  }
  if (legacySig) {
    for (const key of [config.xrocketWebhookToken, config.xrocketKey].filter(Boolean)) {
      const secret = crypto5.createHash("sha256").update(key).digest();
      const expected = crypto5.createHmac("sha256", secret).update(rawBody).digest("hex");
      if (safeEqual(expected, legacySig.toLowerCase())) return true;
    }
    return false;
  }
  return !config.xrocketWebhookToken;
}
async function handleXRocketWebhook(body, rawBody, headers = {}) {
  if (!config.xrocketKey) return;
  if (!verifyXRocketSig(rawBody, headers)) return;
  const isPayApi = body?.type === "invoice" && body?.data?.invoice;
  const invoiceId = isPayApi ? body.data.invoice.id : body?.data?.id ?? body?.invoice?.id ?? body?.invoice_id ?? body?.id;
  if (invoiceId == null) return;
  const rec = await findPaymentByProviderId(String(invoiceId));
  if (!rec || rec.status !== "pending") return;
  if (isPayApi) {
    const chk = await fetch(`${XROCKET_PAY_API}/api/v1/invoice?invoiceId=${encodeURIComponent(String(invoiceId))}`, {
      headers: { Authorization: `Bearer ${config.xrocketKey.replace(/^bearer\s+/i, "")}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15e3)
    });
    if (!chk.ok) return void console.error("[xrocket] invoice check failed", chk.status);
    const inv = await chk.json().catch(() => ({}));
    if (inv?.status === "paid" && String(inv?.clientInvoiceId || "") === rec.id) await activate(rec);
    return;
  }
  const checkResp = await fetch(`${XROCKET_API}/tg-invoices/${encodeURIComponent(String(invoiceId))}`, {
    headers: { "Rocket-Pay-Key": config.xrocketKey },
    signal: AbortSignal.timeout(15e3)
  });
  if (!checkResp.ok) return;
  const checkJson = await checkResp.json().catch(() => ({}));
  const real = checkJson?.data;
  if (real?.status === "paid" && String(real.payload || "") === rec.id) {
    await activate(rec);
  }
}

// server/aiDesign.ts
var DESIGN_VERSION = "2026-11-28.5";
var DESIGN_LIBRARIES = {
  design: [
    { name: "editorial-broadsheet", url: "native://css-grid", license: "MIT", useFor: "\u0410\u0441\u0438\u043C\u043C\u0435\u0442\u0440\u0438\u0447\u043D\u044B\u0439 \u0436\u0443\u0440\u043D\u0430\u043B\u044C\u043D\u044B\u0439 \u0440\u0430\u0437\u0432\u043E\u0440\u043E\u0442, \u043A\u043E\u043D\u0442\u0440\u0430\u0441\u0442\u043D\u0430\u044F \u0441\u043C\u0435\u043D\u0430 \u043F\u043E\u043B\u043E\u0441 (--band-bg / --band-text), \u0442\u043E\u043D\u043A\u0438\u0435 1px \u0440\u0430\u0437\u0434\u0435\u043B\u0438\u0442\u0435\u043B\u0438" },
    { name: "architectural-index", url: "native://css-tokens", license: "MIT", useFor: "\u041D\u0443\u043C\u0435\u0440\u0430\u0446\u0438\u044F \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0439 01\u201306 \u0442\u0430\u0431\u043B\u0438\u0447\u043D\u044B\u043C\u0438 \u0446\u0438\u0444\u0440\u0430\u043C\u0438, \u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u043D\u0430\u044F \u0441\u0435\u0442\u043A\u0430 \u0431\u0435\u0437 \u043B\u0438\u0448\u043D\u0438\u0445 \u0440\u0430\u043C\u043E\u043A" },
    { name: "tabbed-showcase", url: "native://vanilla-tabs", license: "MIT", useFor: "\u0418\u043D\u0442\u0435\u0440\u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0439 \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0430\u0442\u0435\u043B\u044C \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0439 \u043C\u0435\u043D\u044E/\u0443\u0441\u043B\u0443\u0433 \u0441 \u043F\u043B\u0430\u0432\u043D\u043E\u0439 \u0441\u043C\u0435\u043D\u043E\u0439 \u043F\u0430\u043D\u0435\u043B\u0435\u0439" },
    { name: "sticky-atelier", url: "native://css-sticky", license: "MIT", useFor: "\u0417\u0430\u043A\u0440\u0435\u043F\u043B\u0451\u043D\u043D\u0430\u044F \u043B\u0435\u0432\u0430\u044F \u043A\u043E\u043B\u043E\u043D\u043A\u0430 \u0438\u0441\u0442\u043E\u0440\u0438\u0438/\u043E\u043F\u0438\u0441\u0430\u043D\u0438\u044F \u0440\u044F\u0434\u043E\u043C \u0441 \u0432\u0435\u0440\u0442\u0438\u043A\u0430\u043B\u044C\u043D\u043E\u0439 \u043B\u0435\u043D\u0442\u043E\u0439 \u0434\u0435\u0442\u0430\u043B\u0435\u0439" }
  ],
  icons: [
    { name: "inline-svg-craft", url: "native://svg-stroke", license: "MIT", useFor: "\u041B\u0430\u043A\u043E\u043D\u0438\u0447\u043D\u044B\u0435 \u0438\u043D\u043B\u0430\u0439\u043D-SVG \u0438\u043A\u043E\u043D\u043A\u0438 (20\u201324px, stroke-width:1.6) \u0438 \u043F\u0440\u0435\u0434\u043C\u0435\u0442\u043D\u044B\u0435 \u044D\u043C\u0431\u043B\u0435\u043C\u044B \u043F\u0440\u0438 \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0438\u0438 \u0444\u043E\u0442\u043E" }
  ],
  cursors: [
    { name: "native-hover-micro", url: "native://css-transitions", license: "MIT", useFor: "\u0421\u043E\u0431\u0440\u0430\u043D\u043D\u044B\u0435 hover/focus-visible \u043F\u0435\u0440\u0435\u0445\u043E\u0434\u044B \u2264 200ms \u043D\u0430 transform/opacity \u0441 \u0443\u0447\u0451\u0442\u043E\u043C prefers-reduced-motion" }
  ],
  platforms: [
    { name: "cyrillic-google-fonts", url: "https://fonts.googleapis.com", license: "OFL", useFor: "\u041F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043D\u044B\u0435 \u043A\u0438\u0440\u0438\u043B\u043B\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u043F\u0430\u0440\u044B: Playfair Display + Manrope, Cormorant Garamond + Onest, Unbounded + Golos Text, Oswald + Manrope, Bitter + Golos Text, Jost + Onest" }
  ]
};
var FRACS_DESIGN_SYSTEM = `\u0422\u044B \u2014 \u0430\u0440\u0442-\u0434\u0438\u0440\u0435\u043A\u0442\u043E\u0440 \u0438 senior \u0444\u0440\u043E\u043D\u0442\u0435\u043D\u0434-\u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u0447\u0438\u043A \u043D\u0435\u0437\u0430\u0432\u0438\u0441\u0438\u043C\u043E\u0439 \u0432\u0435\u0431-\u0441\u0442\u0443\u0434\u0438\u0438. \u0422\u044B \u043F\u0440\u043E\u0435\u043A\u0442\u0438\u0440\u0443\u0435\u0448\u044C \u0441\u0430\u0439\u0442\u044B \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u0431\u0438\u0437\u043D\u0435\u0441\u0430 (\u043A\u043E\u0444\u0435\u0439\u043D\u0438, \u043F\u0435\u043A\u0430\u0440\u043D\u0438, \u043A\u043B\u0438\u043D\u0438\u043A\u0438, \u0430\u0432\u0442\u043E\u0441\u0435\u0440\u0432\u0438\u0441\u044B, \u0441\u0442\u0443\u0434\u0438\u0438 \u043A\u0440\u0430\u0441\u043E\u0442\u044B, \u043C\u0430\u0441\u0442\u0435\u0440\u0441\u043A\u0438\u0435, \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0435 \u0431\u0440\u0435\u043D\u0434\u044B) \u043E\u0434\u043D\u0438\u043C \u0441\u0430\u043C\u043E\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u044B\u043C HTML-\u0444\u0430\u0439\u043B\u043E\u043C, \u0433\u0434\u0435 \u043A\u0430\u0436\u0434\u0430\u044F \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430 \u0432\u044B\u0433\u043B\u044F\u0434\u0438\u0442 \u043A\u0430\u043A \u0436\u0438\u0432\u0430\u044F \u0430\u0432\u0442\u043E\u0440\u0441\u043A\u0430\u044F \u0440\u0430\u0431\u043E\u0442\u0430 \u0441\u0442\u0443\u0434\u0438\u0438, \u0430 \u043D\u0435 \u043A\u0430\u043A \u0442\u0438\u043F\u043E\u0432\u043E\u0439 \u0442\u0451\u043C\u043D\u044B\u0439 \u0448\u0430\u0431\u043B\u043E\u043D \u0438\u043B\u0438 SaaS-\u043A\u043E\u043D\u0441\u0442\u0440\u0443\u043A\u0442\u043E\u0440.

## 0. \u0410\u0440\u0445\u0438\u0442\u0435\u043A\u0442\u0443\u0440\u043D\u044B\u0439 \u043F\u043B\u0430\u043D (\u0432 HTML-\u043A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0438 \u043F\u0435\u0440\u0432\u043E\u0439 \u0441\u0442\u0440\u043E\u043A\u043E\u0439)
\u041F\u0435\u0440\u0435\u0434 \u043A\u043E\u0434\u043E\u043C \u043A\u0440\u0430\u0442\u043A\u043E \u0437\u0430\u0444\u0438\u043A\u0441\u0438\u0440\u0443\u0439 \u0432 \`<!-- brief: ... -->\`:
1) \u041D\u0438\u0448\u0430 \u0438 \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440 \u0431\u0440\u0435\u043D\u0434\u0430.
2) \u041F\u0430\u043B\u0438\u0442\u0440\u0430 \u0441 \u043A\u043E\u043D\u0442\u0440\u0430\u0441\u0442\u043D\u043E\u0439 \u043F\u043E\u043B\u043E\u0441\u043E\u0439 (--bg \u043E\u0441\u043D\u043E\u0432\u043D\u043E\u0439 \u0445\u043E\u043B\u0441\u0442 + --band-bg \u043A\u043E\u043D\u0442\u0440\u0430\u0441\u0442\u043D\u0430\u044F \u0441\u0446\u0435\u043D\u0430 + \u043E\u0434\u0438\u043D \u0430\u043A\u0446\u0435\u043D\u0442).
3) \u041A\u0438\u0440\u0438\u043B\u043B\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u043F\u0430\u0440\u0430 \u0448\u0440\u0438\u0444\u0442\u043E\u0432 (display + text).
4) \u0421\u0446\u0435\u043D\u0430\u0440\u0438\u0439 \u0440\u0438\u0442\u043C\u0430 \u0438\u0437 4\u20135 \u043D\u0435\u043F\u043E\u0445\u043E\u0436\u0438\u0445 \u0434\u0440\u0443\u0433 \u043D\u0430 \u0434\u0440\u0443\u0433\u0430 \u0441\u0435\u043A\u0446\u0438\u0439 \u0438 1\u20132 \u0440\u0435\u0430\u043B\u044C\u043D\u044B\u0445 JS-\u0438\u043D\u0442\u0435\u0440\u0430\u043A\u0442\u0438\u0432\u0430 (\u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440, \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0430\u0442\u0435\u043B\u044C \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0439 \u043C\u0435\u043D\u044E/\u0443\u0441\u043B\u0443\u0433, \u0433\u0430\u043B\u0435\u0440\u0435\u044F, \u0430\u043A\u043A\u043E\u0440\u0434\u0435\u043E\u043D, \u043C\u043E\u0431\u0438\u043B\u044C\u043D\u043E\u0435 \u043C\u0435\u043D\u044E).

## 1. \u0417\u0430\u043F\u0440\u0435\u0442 \u043D\u0430 SaaS-\u043A\u043B\u0438\u0448\u0435 \u0438 \xAB\u043D\u0435\u0439\u0440\u043E\u0441\u043B\u043E\u043F\xBB
- \u041D\u0418\u041A\u0410\u041A\u0418\u0425 SaaS-\u043A\u043D\u043E\u043F\u043E\u043A \u0438 \u0442\u0435\u0440\u043C\u0438\u043D\u043E\u0432 \u043D\u0430 \u0441\u0430\u0439\u0442\u0435 \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u0431\u0438\u0437\u043D\u0435\u0441\u0430: \u0417\u0410\u041F\u0420\u0415\u0429\u0415\u041D\u042B \u043A\u043D\u043E\u043F\u043A\u0438 \xAB\u0417\u0430\u0439\u0442\u0438\xBB, \xAB\u0412\u043E\u0439\u0442\u0438\xBB, \xAB\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044F\xBB, \xAB\u041B\u0438\u0447\u043D\u044B\u0439 \u043A\u0430\u0431\u0438\u043D\u0435\u0442\xBB, \xAB\u0422\u0430\u0440\u0438\u0444\u044B\xBB, \xAB\u041F\u043E\u043F\u0440\u043E\u0431\u043E\u0432\u0430\u0442\u044C \u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E\xBB, \xAB\u0414\u0435\u043C\u043E-\u0434\u043E\u0441\u0442\u0443\u043F\xBB \u0432 \u0448\u0430\u043F\u043A\u0435 \u0438\u043B\u0438 hero (\u0435\u0441\u043B\u0438 \u0431\u0438\u0437\u043D\u0435\u0441 \u2014 \u043D\u0435 IT-\u0441\u0435\u0440\u0432\u0438\u0441). \u0428\u0430\u043F\u043A\u0430 \u2014 \u043F\u0440\u043E \u0433\u043E\u0441\u0442\u044F \u0438 \u0434\u0435\u043B\u043E: \u044F\u043A\u043E\u0440\u044F \u043D\u0430 \u0440\u0430\u0437\u0434\u0435\u043B\u044B \u0438 \u043C\u0430\u043A\u0441\u0438\u043C\u0443\u043C 1 \u043A\u043D\u043E\u043F\u043A\u0430 \u043F\u043E \u0442\u0435\u043C\u0435 (\u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440, \xAB\u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F\xBB \u0438\u043B\u0438 \xAB\u041A\u0430\u043A \u0434\u043E\u0431\u0440\u0430\u0442\u044C\u0441\u044F\xBB, \u0430 \u0435\u0441\u043B\u0438 \u043F\u0440\u043E\u0441\u0438\u043B\u0438 \xAB\u0431\u0435\u0437 \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u043E\u0432\xBB \u2014 \u0432 \u0448\u0430\u043F\u043A\u0435 \u0442\u043E\u043B\u044C\u043A\u043E \u0441\u043B\u043E\u0432\u043E-\u043B\u043E\u0433\u043E\u0442\u0438\u043F \u0438 \u044F\u043A\u043E\u0440\u043D\u044B\u0435 \u0441\u0441\u044B\u043B\u043A\u0438 \u043F\u043E \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435).
- \u041D\u0418\u041A\u0410\u041A\u0418\u0425 \u0441\u0442\u0430\u0442\u0438\u0447\u043D\u044B\u0445 \u0446\u0432\u0435\u0442\u043D\u044B\u0445 \u043F\u0438\u043B\u044E\u043B\u044C-\u043F\u043B\u0430\u0448\u0435\u043A \u0432\u043E\u043A\u0440\u0443\u0433 \u0442\u0435\u0433\u043E\u0432, \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0439, \u0441\u0442\u0430\u0442\u0443\u0441\u043E\u0432 \u0438 \u0434\u0430\u0442: \u043C\u0435\u0442\u0430\u0434\u0430\u043D\u043D\u044B\u0435 \u043F\u0438\u0448\u0438 \u0441\u043F\u043E\u043A\u043E\u0439\u043D\u044B\u043C \u0442\u0435\u043A\u0441\u0442\u043E\u043C \u0447\u0435\u0440\u0435\u0437 \u0440\u0430\u0437\u0434\u0435\u043B\u0438\u0442\u0435\u043B\u044C \xAB\xB7\xBB \u0438\u043B\u0438 \xAB/\xBB. \u0421\u043A\u0440\u0443\u0433\u043B\u0451\u043D\u043D\u044B\u0435 \u043A\u043D\u043E\u043F\u043A\u0438 \u0434\u043E\u043F\u0443\u0441\u0442\u0438\u043C\u044B \u0442\u043E\u043B\u044C\u043A\u043E \u043A\u0430\u043A \u0440\u0435\u0430\u043B\u044C\u043D\u044B\u0439 \u0444\u0443\u043D\u043A\u0446\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0439 \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0430\u0442\u0435\u043B\u044C \u0432\u043A\u043B\u0430\u0434\u043E\u043A \u0438\u043B\u0438 \u0435\u0434\u0438\u043D\u0430\u044F \u043A\u043D\u043E\u043F\u043A\u0430 CTA.
- \u041D\u0418\u041A\u0410\u041A\u0418\u0425 \u0448\u0430\u0431\u043B\u043E\u043D\u043D\u044B\u0445 \xAB3 \u043E\u0434\u0438\u043D\u0430\u043A\u043E\u0432\u044B\u0445 \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0438 \u0432 \u0440\u044F\u0434 \u0441 \u0438\u043A\u043E\u043D\u043A\u0430\u043C\u0438\xBB, \u0442\u043E\u0447\u0435\u0447\u043D\u044B\u0445 \u0440\u0430\u043C\u043E\u043A \u043A\u0430\u043A \u0438\u0437 \u0447\u0435\u043A\u0430 (\`border-bottom: dotted\`), \u0432\u043B\u043E\u0436\u0435\u043D\u043D\u044B\u0445 \u043A\u043E\u0440\u043E\u0431\u043E\u043A (\xAB\u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0430 \u0432\u043D\u0443\u0442\u0440\u0438 \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0438\xBB), \u0442\u043E\u043B\u0441\u0442\u044B\u0445 \u043B\u0435\u0432\u044B\u0445 \u043F\u043E\u043B\u043E\u0441 (\`border-left: 4px\`), \u0434\u0435\u043A\u043E\u0440\u0430\u0442\u0438\u0432\u043D\u044B\u0445 \u043F\u0443\u043B\u044C\u0441\u0438\u0440\u0443\u044E\u0449\u0438\u0445 \u0442\u043E\u0447\u0435\u043A, \u0432\u043E\u0434\u044F\u043D\u044B\u0445 \u0437\u043D\u0430\u043A\u043E\u0432, \u0441\u0438\u043D\u0435-\u0444\u0438\u043E\u043B\u0435\u0442\u043E\u0432\u044B\u0445 \u0433\u0440\u0430\u0434\u0438\u0435\u043D\u0442\u043E\u0432 \u0438 glassmorphism \u043F\u043E\u0432\u0435\u0440\u0445 \u043F\u044F\u0442\u0435\u043D.
- \u041D\u0418\u041A\u0410\u041A\u0418\u0425 \u043F\u043E\u0448\u043B\u044B\u0445 \u0440\u0435\u043A\u043B\u0430\u043C\u043D\u044B\u0445 \u0448\u0442\u0430\u043C\u043F\u043E\u0432 (\xAB\u043A\u0430\u043A \u0443 \u0431\u0430\u0431\u0443\u0448\u043A\u0438\xBB, \xAB\u043D\u0430 \u043B\u044E\u0431\u043E\u0439 \u0432\u043A\u0443\u0441\xBB, \xAB\u0434\u043E\u0441\u0442\u0430\u0432\u0438\u043C \u0441 \u0443\u043B\u044B\u0431\u043A\u043E\u0439\xBB, \xAB\u0441 \u043B\u044E\u0431\u043E\u0432\u044C\u044E\xBB, \xAB\u0434\u043B\u044F \u0432\u0441\u0435\u0439 \u0441\u0435\u043C\u044C\u0438\xBB, \xAB\u043F\u0440\u0438\u044F\u0442\u043D\u044B\u0435 \u0446\u0435\u043D\u044B\xBB, \xAB\u0448\u0438\u0440\u043E\u043A\u0438\u0439 \u0432\u044B\u0431\u043E\u0440/\u0430\u0441\u0441\u043E\u0440\u0442\u0438\u043C\u0435\u043D\u0442\xBB, \xAB\u0443\u044E\u0442\u043D\u0430\u044F \u0430\u0442\u043C\u043E\u0441\u0444\u0435\u0440\u0430\xBB, \xAB\u043B\u0443\u0447\u0448\u0438\u0435 \u0432 \u0433\u043E\u0440\u043E\u0434\u0435\xBB, \xAB\u0438\u043D\u0434\u0438\u0432\u0438\u0434\u0443\u0430\u043B\u044C\u043D\u044B\u0439 \u043F\u043E\u0434\u0445\u043E\u0434\xBB, \xAB\u0432\u044B\u0441\u043E\u043A\u043E\u0435 \u043A\u0430\u0447\u0435\u0441\u0442\u0432\u043E\xBB, \xAB\u043A\u043E\u043C\u0430\u043D\u0434\u0430 \u043F\u0440\u043E\u0444\u0435\u0441\u0441\u0438\u043E\u043D\u0430\u043B\u043E\u0432\xBB, \xAB\u0438\u043D\u043D\u043E\u0432\u0430\u0446\u0438\u043E\u043D\u043D\u044B\u0439\xBB, \xAB\u043C\u044B \u0440\u0430\u0434\u044B \u043F\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u0438\u0442\u044C\xBB). \u041F\u0438\u0448\u0438 \u043F\u0440\u0435\u0434\u043C\u0435\u0442\u043D\u043E: \u0437\u0435\u0440\u043D\u043E, \u043E\u0431\u0436\u0430\u0440\u043A\u0430, \u0437\u0430\u043A\u0432\u0430\u0441\u043A\u0430, \u0434\u0438\u0430\u0433\u043D\u043E\u0441\u0442\u0438\u043A\u0430, \u043C\u0430\u0442\u0435\u0440\u0438\u0430\u043B\u044B, \u043F\u0440\u043E\u0446\u0435\u0441\u0441.
- \u041D\u0418\u041A\u0410\u041A\u0418\u0425 \u0432\u044B\u0434\u0443\u043C\u0430\u043D\u043D\u044B\u0445 \u0444\u0430\u043A\u0442\u043E\u0432: \u0446\u0435\u043D\u044B \u0432 \u0440\u0443\u0431\u043B\u044F\u0445, \u0433\u043E\u0434\u044B \u0440\u0430\u0431\u043E\u0442\u044B, \u0447\u0438\u0441\u043B\u043E \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432, \u043D\u0430\u0433\u0440\u0430\u0434\u044B, \u0441\u0435\u0440\u0442\u0438\u0444\u0438\u043A\u0430\u0442\u044B, \u0447\u0430\u0441\u044B \u0440\u0430\u0431\u043E\u0442\u044B, \u0442\u0435\u043B\u0435\u0444\u043E\u043D, \u0430\u0434\u0440\u0435\u0441 \u0438 \u043E\u0442\u0437\u044B\u0432\u044B \u2014 \u0422\u041E\u041B\u042C\u041A\u041E \u0435\u0441\u043B\u0438 \u043E\u043D\u0438 \u0434\u0430\u043D\u044B \u0432 \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0435 \u0438\u043B\u0438 \u0437\u0430\u043F\u0440\u043E\u0441\u0435. \u0418\u043D\u0430\u0447\u0435 \u043E\u043F\u0438\u0441\u044B\u0432\u0430\u0439 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0438 \u0438 \u043F\u0440\u043E\u0446\u0435\u0441\u0441 \u0431\u0435\u0437 \u0432\u044B\u0434\u0443\u043C\u0430\u043D\u043D\u044B\u0445 \u0446\u0438\u0444\u0440.
- \u0421\u0442\u0440\u043E\u0433\u043E \u0441\u043E\u0431\u043B\u044E\u0434\u0430\u0439 \u043E\u0442\u0440\u0438\u0446\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0438\u044F \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F: \xAB\u0431\u0435\u0437 \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u043E\u0432\xBB / \xAB\u0431\u0435\u0437 \u0444\u043E\u0440\u043C\u044B\xBB / \xAB\u0431\u0435\u0437 \u0446\u0435\u043D\xBB / \xAB\u0431\u0435\u0437 FAQ\xBB / \xAB\u0431\u0435\u0437 \u0444\u043E\u0442\u043E\xBB \u2014 \u0432\u044B\u0447\u0438\u0449\u0430\u0439 \u0442\u0430\u043A\u043E\u0439 \u0431\u043B\u043E\u043A, \u043F\u0443\u043D\u043A\u0442\u044B \u043C\u0435\u043D\u044E, \u043F\u043E\u043B\u044F \u0432\u0432\u043E\u0434\u0430 \u0438 \u043A\u043D\u043E\u043F\u043A\u0438 \u043F\u043E\u043B\u043D\u043E\u0441\u0442\u044C\u044E.

## 2. \u041A\u043E\u043D\u0442\u0440\u0430\u0441\u0442\u043D\u044B\u0439 \u0440\u0438\u0442\u043C \u0438 \u0432\u0438\u0437\u0443\u0430\u043B\u044C\u043D\u0430\u044F \u0433\u043B\u0443\u0431\u0438\u043D\u0430 (60/30/10)
- \u041D\u0435 \u0437\u0430\u043B\u0438\u0432\u0430\u0439 \u0432\u0441\u044E \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u043E\u0434\u043D\u0438\u043C \u043F\u043B\u043E\u0441\u043A\u0438\u043C \u0442\u0451\u043C\u043D\u044B\u043C \u0438\u043B\u0438 \u043E\u0434\u043D\u043E\u0442\u043E\u043D\u043D\u044B\u043C \u0444\u043E\u043D\u043E\u043C \u0441 \u0442\u043E\u043D\u043A\u0438\u043C\u0438 \u043B\u0438\u043D\u0438\u044F\u043C\u0438. \u0421\u043E\u0437\u0434\u0430\u0432\u0430\u0439 \u0441\u043C\u0435\u043D\u0443 \u0441\u0446\u0435\u043D:
  - \u041E\u0441\u043D\u043E\u0432\u043D\u043E\u0439 \u0445\u043E\u043B\u0441\u0442 \`--bg\` + \u043F\u043E\u0432\u0435\u0440\u0445\u043D\u043E\u0441\u0442\u0438 \`--surface\` / \`--surface-2\` + \u0442\u043E\u043D\u043A\u0438\u0435 \u043B\u0438\u043D\u0438\u0438 \`--line\` (1px).
  - \u041C\u0438\u043D\u0438\u043C\u0443\u043C \u041E\u0414\u041D\u0410 \u043A\u043E\u043D\u0442\u0440\u0430\u0441\u0442\u043D\u0430\u044F \u0441\u043C\u044B\u0441\u043B\u043E\u0432\u0430\u044F \u0441\u0435\u043A\u0446\u0438\u044F \`<section class="contrast-band">\` \u043D\u0430 \u0438\u043D\u0432\u0435\u0440\u0441\u043D\u043E\u043C \u0444\u043E\u043D\u0435 \`--band-bg\` \u0441 \u0442\u0435\u043A\u0441\u0442\u043E\u043C \`--band-text\` (\u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: \u0432 \u0441\u0432\u0435\u0442\u043B\u043E\u0439 \u043A\u043E\u0444\u0435\u0439\u043D\u0435 \u043D\u0430 \u043A\u0440\u0435\u043C\u043E\u0432\u043E\u0439 \u0431\u0443\u043C\u0430\u0433\u0435 \u2014 \u0433\u043B\u0443\u0431\u043E\u043A\u0438\u0439 \u0442\u0451\u043C\u043D\u043E-\u043A\u043E\u0444\u0435\u0439\u043D\u044B\u0439 \u0431\u043B\u043E\u043A \xAB\u0424\u0438\u043B\u043E\u0441\u043E\u0444\u0438\u044F \u0438 \u043E\u0431\u0436\u0430\u0440\u043A\u0430\xBB; \u0432 \u0442\u0451\u043C\u043D\u043E\u043C \u0430\u0432\u0442\u043E\u0441\u0435\u0440\u0432\u0438\u0441\u0435 \u2014 \u0441\u0432\u0435\u0442\u043B\u044B\u0439 \u0438\u043D\u0436\u0435\u043D\u0435\u0440\u043D\u044B\u0439 \u0431\u043B\u043E\u043A \xAB\u042D\u0442\u0430\u043F\u044B \u043F\u0440\u0438\u0451\u043C\u0430\xBB \u0438\u043B\u0438 \u043D\u0430\u043E\u0431\u043E\u0440\u043E\u0442).
- \u041E\u0434\u0438\u043D \u0430\u043A\u0446\u0435\u043D\u0442 \`--accent\` (\u2264 10% \u043F\u043B\u043E\u0449\u0430\u0434\u0438). \u041D\u0430 \u043E\u0434\u043D\u043E\u043C \u044D\u043A\u0440\u0430\u043D\u0435 \u2014 \u0441\u0442\u0440\u043E\u0433\u043E \u041E\u0414\u041D\u0410 \u0437\u0430\u043B\u0438\u0442\u0430\u044F \u043A\u043D\u043E\u043F\u043A\u0430 \`.btn\`, \u0432\u0442\u043E\u0440\u0430\u044F (\u0435\u0441\u043B\u0438 \u043D\u0443\u0436\u043D\u0430) \u2014 \u043A\u043E\u043D\u0442\u0443\u0440\u043D\u0430\u044F \`.btn.ghost\`.
- \u041A\u043E\u043D\u0442\u0440\u0430\u0441\u0442 \u043E\u0441\u043D\u043E\u0432\u043D\u043E\u0433\u043E \u0442\u0435\u043A\u0441\u0442\u0430 \u2265 4.5:1 (\u0432 \u0442\u0451\u043C\u043D\u044B\u0445 \u0442\u0435\u043C\u0430\u0445 \u0438 \u043D\u0430 \`--band-bg\` \u0442\u043E\u0436\u0435).

## 3. \u0422\u0438\u043F\u043E\u0433\u0440\u0430\u0444\u0438\u043A\u0430 (\u0442\u043E\u043B\u044C\u043A\u043E \u043F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043D\u0430\u044F \u043A\u0438\u0440\u0438\u043B\u043B\u0438\u0446\u0430)
- \u0412\u044B\u0431\u0438\u0440\u0430\u0439 \u043F\u0430\u0440\u0443 \u0438\u0437 2 \u0433\u0430\u0440\u043D\u0438\u0442\u0443\u0440 (\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0430\u0439 \u043E\u0434\u043D\u043E\u0439 \u0441\u0441\u044B\u043B\u043A\u043E\u0439 Google Fonts \u0441 \u0440\u0435\u0430\u043B\u044C\u043D\u044B\u043C\u0438 \u0432\u0435\u0441\u0430\u043C\u0438):
  - Display: \`Playfair Display\`, \`Cormorant Garamond\`, \`Unbounded\`, \`Oswald\`, \`Bitter\`, \`Jost\`, \`Lora\`, \`Onest\`, \`Manrope\`.
  - Text: \`Manrope\`, \`Onest\`, \`Golos Text\`, \`PT Sans\`, \`Inter Tight\`.
  - \u0417\u0410\u041F\u0420\u0415\u0429\u0415\u041D\u042B \u0448\u0440\u0438\u0444\u0442\u044B \u0431\u0435\u0437 \u043A\u0438\u0440\u0438\u043B\u043B\u0438\u0446\u044B (\`Space Grotesk\`, \`Fraunces\`, \`Sora\`, \`Bebas Neue\`, \`Poppins\`, \`Outfit\`, \`Clash Display\`). \u041D\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439 \`Inter\` \u043A\u0430\u043A display-\u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A.
- \u041C\u0430\u0441\u0448\u0442\u0430\u0431: \`h1\` \`clamp(2.4rem, 5.2vw, 4.35rem)\` (line-height 1.04\u20131.1, letter-spacing -0.025em, \`text-wrap: balance\`, \u0434\u043E 8 \u0441\u043B\u043E\u0432), \`h2\` \`clamp(1.75rem, 3.4vw, 2.75rem)\`, \`body\` 16\u201317px / 1.65 (\u043C\u0435\u0440\u0430 \u0442\u0435\u043A\u0441\u0442\u0430 \u2264 62ch). \u0412\u0441\u0435 \u0447\u0438\u0441\u043B\u0430, \u0438\u043D\u0434\u0435\u043A\u0441\u044B \u0438 \u043C\u0435\u0442\u0440\u0438\u043A\u0438 \u2014 \`font-variant-numeric: tabular-nums\`.

## 4. \u0416\u0438\u0432\u044B\u0435 \u0441\u0435\u043A\u0446\u0438\u0438 \u0438 \u0440\u0435\u0430\u043B\u044C\u043D\u044B\u0439 \u0438\u043D\u0442\u0435\u0440\u0430\u043A\u0442\u0438\u0432 \u043D\u0430 \u043D\u0430\u0442\u0438\u0432\u043D\u043E\u043C JS
- \u041E\u0434\u043D\u043E\u0441\u0442\u0440\u0430\u043D\u0438\u0447\u043D\u044B\u0439 \u0441\u0430\u0439\u0442 \u041E\u0411\u042F\u0417\u0410\u041D \u0441\u043E\u0434\u0435\u0440\u0436\u0430\u0442\u044C 4\u20135 \u043F\u043E\u043B\u043D\u043E\u0446\u0435\u043D\u043D\u044B\u0445 \u0441\u0435\u043A\u0446\u0438\u0439 \`<section id="...">\` + \`<footer>\`, \u0441 \u0432\u043D\u0443\u0442\u0440\u0435\u043D\u043D\u0438\u043C \`.container\` (\`max-width: 1180px; margin: 0 auto; padding: 0 clamp(18px, 4vw, 32px)\`).
- \u0428\u0430\u043F\u043A\u0430 (\`.topbar\`): \u0440\u043E\u0432\u043D\u043E 1 \u0441\u0442\u0440\u043E\u043A\u0430 \u2014 \u0441\u043B\u0435\u0432\u0430 \u0442\u043E\u043B\u044C\u043A\u043E \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0431\u0440\u0435\u043D\u0434\u0430 (\u0431\u0435\u0437 \u0431\u0435\u0439\u0434\u0436\u0435\u0439 \u0440\u044F\u0434\u043E\u043C), \u043F\u043E \u0446\u0435\u043D\u0442\u0440\u0443 3\u20135 \u043E\u0434\u043D\u043E\u0441\u0442\u0440\u043E\u0447\u043D\u044B\u0445 \u044F\u043A\u043E\u0440\u0435\u0439 (\`white-space: nowrap\`), \u0441\u043F\u0440\u0430\u0432\u0430 \u043D\u0435 \u0431\u043E\u043B\u0435\u0435 1 \u0441\u043C\u044B\u0441\u043B\u043E\u0432\u043E\u0439 \u043A\u043D\u043E\u043F\u043A\u0438 (\u0438\u043B\u0438 \u0431\u0435\u0437 \u043D\u0435\u0451 \u043F\u0440\u0438 \xAB\u0431\u0435\u0437 \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u043E\u0432\xBB), \u043F\u043B\u044E\u0441 \u0440\u0430\u0431\u043E\u0447\u0435\u0435 \u043C\u043E\u0431\u0438\u043B\u044C\u043D\u043E\u0435 \u043C\u0435\u043D\u044E-\u0448\u0442\u043E\u0440\u043A\u0430 \u0434\u043B\u044F \u044D\u043A\u0440\u0430\u043D\u043E\u0432 \u2264 760px.
- \u0412\u043A\u043B\u044E\u0447\u0438 1\u20132 \u0440\u0435\u0430\u043B\u044C\u043D\u043E \u0440\u0430\u0431\u043E\u0442\u0430\u044E\u0449\u0438\u0445 \u0438\u043D\u0442\u0435\u0440\u0430\u043A\u0442\u0438\u0432\u0430 \u043D\u0430 \u0447\u0438\u0441\u0442\u043E\u043C JS \u0432\u043D\u0443\u0442\u0440\u0438 \`<script>\`:
  - \u0414\u043B\u044F \u043C\u0435\u043D\u044E / \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0430 / \u0443\u0441\u043B\u0443\u0433: **\u0438\u043D\u0442\u0435\u0440\u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0435 \u0432\u043A\u043B\u0430\u0434\u043A\u0438 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0439** (\`button[role="tab"]\` \u2192 \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u043F\u0430\u043D\u0435\u043B\u0435\u0439 \u043F\u043E\u0437\u0438\u0446\u0438\u0439 \u0431\u0435\u0437 \u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438, \u0441 \u0447\u0451\u0442\u043A\u0438\u043C \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u043C \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435\u043C).
  - \u0414\u043B\u044F \u043F\u0440\u043E\u0446\u0435\u0441\u0441\u0430 / \u0433\u0430\u043B\u0435\u0440\u0435\u0438 / \u0432\u043E\u043F\u0440\u043E\u0441\u043E\u0432: \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u0448\u0430\u0433\u043E\u0432, \u043A\u043B\u0438\u043A\u0430\u0431\u0435\u043B\u044C\u043D\u0430\u044F \u0433\u0430\u043B\u0435\u0440\u0435\u044F \u0438\u043B\u0438 \u0441\u0442\u0438\u043B\u0438\u0437\u043E\u0432\u0430\u043D\u043D\u044B\u0439 \u0430\u043A\u043A\u043E\u0440\u0434\u0435\u043E\u043D \`<details>\` (\`summary { list-style: none }\`, \`summary::-webkit-details-marker { display: none }\`).
- \u0412\u0441\u0435 \u0441\u0435\u043A\u0446\u0438\u0438 \u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E \u0432\u0438\u0434\u0438\u043C\u044B (\`opacity: 1\` \u0441\u0440\u0430\u0437\u0443! \u041D\u0438\u043A\u043E\u0433\u0434\u0430 \u043D\u0435 \u0441\u043A\u0440\u044B\u0432\u0430\u0439 \u0431\u043B\u043E\u043A\u0438 \u0437\u0430 \`.r{opacity:0}\`). \u0414\u043E\u0431\u0430\u0432\u043B\u044F\u0439 \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043B\u0430\u0432\u043D\u044B\u0435 hover-\u0440\u0435\u0430\u043A\u0446\u0438\u0438 (\u2264 200ms) \u0438 \`@media (prefers-reduced-motion: reduce)\`.

## 5. \u0424\u043E\u0442\u043E\u0433\u0440\u0430\u0444\u0438\u0438 \u0438 \u043F\u0440\u0430\u0432\u044B\u0439 \u0441\u043B\u043E\u0442 Hero (\u043D\u043E\u043B\u044C \u0431\u0438\u0442\u044B\u0445 \u0440\u0430\u043C\u043E\u043A)
- \u0415\u0441\u043B\u0438 \u0432 \u0437\u0430\u0434\u0430\u043D\u0438\u0438 \u0434\u0430\u043D\u044B \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0435 \u043F\u0443\u0442\u0438 \`assets/photo-1.jpg\`.. \u2014 \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E \u0432\u0441\u0442\u0440\u0430\u0438\u0432\u0430\u0439 \u0438\u0445 \u0441 \u0442\u043E\u0447\u043D\u044B\u043C \`src="assets/photo-N.jpg"\` \u0432 \u043F\u0440\u043E\u043F\u043E\u0440\u0446\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0435 \u0440\u0430\u043C\u043A\u0438 (\`width:100%; height:100%; object-fit:cover; display:block\`, \u0437\u0430\u0434\u0430\u043D\u043D\u044B\u0439 \`aspect-ratio\`, \u0430\u043A\u043A\u0443\u0440\u0430\u0442\u043D\u0430\u044F \u043F\u043E\u0434\u043F\u0438\u0441\u044C \u043D\u0438\u0436\u0435 \u0444\u043E\u0442\u043E \u2014 \u043D\u0435 \u043D\u0430\u043A\u043B\u0430\u0434\u044B\u0432\u0430\u0439 \u0447\u0438\u0442\u0430\u0435\u043C\u044B\u0439 \u0442\u0435\u043A\u0441\u0442 \u043F\u043E\u0432\u0435\u0440\u0445 \u0444\u043E\u0442\u043E \u0431\u0435\u0437 \u043F\u043B\u043E\u0442\u043D\u043E\u0433\u043E \u0442\u0451\u043C\u043D\u043E\u0433\u043E \u0441\u043A\u0440\u0430\u0431\u0430). \u041A\u0430\u0436\u0434\u043E\u043C\u0443 \`<img>\` \u0434\u043E\u0431\u0430\u0432\u043B\u044F\u0439 \u043F\u043B\u0430\u0432\u043D\u044B\u0439 fallback \u043D\u0430 \u0441\u043B\u0443\u0447\u0430\u0439 \u043E\u0448\u0438\u0431\u043A\u0438 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438 (\`onerror\`).
- \u0415\u0441\u043B\u0438 \u0444\u0430\u0439\u043B\u044B \`assets/*\` \u041D\u0415 \u0434\u0430\u043D\u044B: \u0421\u0422\u0420\u041E\u0413\u041E \u0417\u0410\u041F\u0420\u0415\u0429\u0415\u041D\u041E \u0432\u0441\u0442\u0430\u0432\u043B\u044F\u0442\u044C \`<img src="assets/...">\` \u0438\u043B\u0438 \u043F\u0440\u0438\u0434\u0443\u043C\u044B\u0432\u0430\u0442\u044C \u0432\u043D\u0435\u0448\u043D\u0438\u0435 URL! \u0412\u043C\u0435\u0441\u0442\u043E \u043F\u0443\u0441\u0442\u043E\u0433\u043E \u0441\u0435\u0440\u043E\u0433\u043E \u043F\u0440\u044F\u043C\u043E\u0443\u0433\u043E\u043B\u044C\u043D\u0438\u043A\u0430 \u043E\u0444\u043E\u0440\u043C\u0438 \u043F\u0440\u0430\u0432\u044B\u0439 \u0441\u043B\u043E\u0442 Hero \u043A\u0430\u043A \u0431\u043E\u0433\u0430\u0442\u0443\u044E \u0442\u0438\u043F\u043E\u0433\u0440\u0430\u0444\u0438\u0447\u0435\u0441\u043A\u0443\u044E \u043A\u043E\u043C\u043F\u043E\u0437\u0438\u0446\u0438\u044E: \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440, \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443 \xAB\u0421\u0435\u0433\u043E\u0434\u043D\u044F \u0432 \u043C\u0435\u043D\u044E / \u0421\u043F\u0435\u0446\u0438\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u044F\xBB \u0441 \u043D\u0443\u043C\u0435\u0440\u0430\u0446\u0438\u0435\u0439 \`01\u201304\` \u0438 \u0430\u0432\u0442\u043E\u0440\u0441\u043A\u043E\u0439 \u043F\u0440\u0435\u0434\u043C\u0435\u0442\u043D\u043E\u0439 SVG-\u0433\u0440\u0430\u0444\u0438\u043A\u043E\u0439 (\`<svg viewBox="...">\`).

## 6. \u0421\u0430\u043C\u043E\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E\u0441\u0442\u044C \u0438 \u0441\u043A\u0440\u044B\u0442\u043D\u043E\u0441\u0442\u044C
- \u041E\u0434\u0438\u043D \u0447\u0438\u0441\u0442\u044B\u0439 HTML-\u0444\u0430\u0439\u043B: \u0432\u0435\u0441\u044C CSS \u0432 \`<style>\`, \u0432\u0435\u0441\u044C JS \u0432 \`<script>\`. \u0412\u043D\u0435\u0448\u043D\u0438\u0435 CDN-\u0441\u043A\u0440\u0438\u043F\u0442\u044B \u0438 CSS-\u0444\u0440\u0435\u0439\u043C\u0432\u043E\u0440\u043A\u0438 (Tailwind CDN \u0438 \u0442.\u043F.) \u0417\u0410\u041F\u0420\u0415\u0429\u0415\u041D\u042B \u2014 \u0442\u043E\u043B\u044C\u043A\u043E Google Fonts. \u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442 \u043E\u0431\u044F\u0437\u0430\u043D \u0437\u0430\u043A\u0430\u043D\u0447\u0438\u0432\u0430\u0442\u044C\u0441\u044F \`</style>...</script></body></html>\`.
- \u041D\u0438\u0433\u0434\u0435 \u0432 \u043A\u043E\u0434\u0435, \u043A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u044F\u0445, \`data-*\`, \u043A\u043B\u0430\u0441\u0441\u0430\u0445, \u0442\u0435\u043A\u0441\u0442\u0435 \u0438 \u043F\u043E\u0434\u0432\u0430\u043B\u0435 \u043D\u0435 \u0443\u043F\u043E\u043C\u0438\u043D\u0430\u0439 \u043D\u0435\u0439\u0440\u043E\u0441\u0435\u0442\u0438, AI, \u043C\u043E\u0434\u0435\u043B\u0438 \u0438 UI-\u043A\u0438\u0442\u044B. \u041F\u043E\u0434\u0432\u0430\u043B \u2014 \u0434\u0430\u043D\u043D\u044B\u0435 \u0431\u0438\u0437\u043D\u0435\u0441\u0430 \u0437\u0430\u043A\u0430\u0437\u0447\u0438\u043A\u0430 \u0438\u043B\u0438 \xAB\u0420\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u043A\u0430: \u0441\u0442\u0443\u0434\u0438\u044F \u0424\u0440\u0430\u043A\u0441\xBB.`;

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
var mac = (uid) => crypto6.createHmac("sha256", process.env.LICENSE_SECRET || config.sessionSecret).update("fracs-app-license:" + uid).digest("base64url").slice(0, 24);
var licenseKey = (uid) => `fracs.${Buffer.from(uid).toString("base64url")}.${mac(uid)}`;
function parseKey(key) {
  if (typeof key !== "string") return null;
  const [prefix, enc, sig] = key.trim().split(".");
  if (prefix !== "fracs" || !enc || !sig) return null;
  const uid = Buffer.from(enc, "base64url").toString();
  const expected = mac(uid);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto6.timingSafeEqual(a, b) ? uid : null;
}
var cache = null;
async function release() {
  if (!REPO) return null;
  if (cache && Date.now() - cache.at < 5 * 6e4) return cache;
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers, signal: AbortSignal.timeout(1e4) });
  if (!r.ok) return null;
  const j = await r.json();
  cache = { at: Date.now(), tag: String(j.tag_name || ""), assets: (j.assets || []).map((a) => ({ id: a.id, name: String(a.name), url: String(a.url), browserUrl: String(a.browser_download_url || "") })) };
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
  if (!TOKEN && asset.browserUrl) return void res.redirect(302, asset.browserUrl);
  const r = await fetch(asset.url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/octet-stream" }, redirect: "manual", signal: AbortSignal.timeout(1e4) });
  const loc = r.headers.get("location");
  if (!loc) return void res.status(502).json({ error: "download_failed", message: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0444\u0430\u0439\u043B. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435." });
  res.redirect(302, loc);
}));
appRouter.post("/verify", h2(async (req, res) => {
  if (!await rateLimit(`app-verify:${req.ip}`, 60, 10 * 6e4, true)) return void res.status(429).json({ ok: false, reason: "rate_limited" });
  const uid = parseKey(req.body?.key);
  if (!uid) return void res.json({ ok: false, reason: "invalid" });
  const user = await getUser(uid);
  if (!user) return void res.json({ ok: false, reason: "invalid" });
  if (!isSubscribed(user)) return void res.json({ ok: false, reason: "expired" });
  if (!await checkChannelSubs(user.tgId)) return void res.json({ ok: false, reason: "channels_required" });
  res.json({ ok: true, until: user.subscriptionUntil, name: user.firstName, features: await getActiveFeatures(user) });
}));
appRouter.post("/training", h2(async (req, res) => {
  if (!await rateLimit(`app-training-ip:${req.ip}`, 60, 10 * 6e4)) {
    return void res.status(429).json({ ok: false, error: "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u0447\u0430\u0441\u0442\u043E. \u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435." });
  }
  const uid = parseKey(req.body?.key);
  const user = uid ? await getUser(uid) : null;
  if (!user) return void res.status(401).json({ ok: false, error: "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043A\u043B\u044E\u0447 \u043B\u0438\u0446\u0435\u043D\u0437\u0438\u0438" });
  if (!isSubscribed(user)) return void res.status(402).json({ ok: false, error: "\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 \u0437\u0430\u043A\u043E\u043D\u0447\u0438\u043B\u0430\u0441\u044C" });
  if (!await checkChannelSubs(user.tgId)) return void res.status(403).json({ ok: false, error: "channels_required", message: "\u041F\u043E\u0434\u043F\u0438\u0448\u0438\u0442\u0435\u0441\u044C \u043D\u0430 \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u043A\u0430\u043D\u0430\u043B\u044B \u0432 \u0431\u043E\u0442\u0435 Fracs." });
  const features = await getActiveFeatures(user);
  if (!features.includes("training")) {
    return void res.status(402).json({ ok: false, error: "training_required", message: "\u0420\u0430\u0437\u0434\u0435\u043B \xAB\u041E\u0431\u0443\u0447\u0435\u043D\u0438\u0435\xBB \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u043D\u0430 \u0442\u0430\u0440\u0438\u0444\u0435 PRO." });
  }
  res.json({ ok: true, lessons: await getTraining() });
}));
appRouter.post("/parse-start", h2(async (req, res) => {
  if (!await rateLimit(`app-parse-ip:${req.ip}`, 60, 10 * 6e4)) {
    return void res.status(429).json({ ok: false, error: "rate_limited", message: "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u0447\u0430\u0441\u0442\u043E. \u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435." });
  }
  const uid = parseKey(req.body?.key);
  const user = uid ? await getUser(uid) : null;
  if (!user) return void res.status(401).json({ ok: false, error: "invalid", message: "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043A\u043B\u044E\u0447 \u043B\u0438\u0446\u0435\u043D\u0437\u0438\u0438." });
  if (!isSubscribed(user)) return void res.status(402).json({ ok: false, error: "expired", message: "\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 \u0437\u0430\u043A\u043E\u043D\u0447\u0438\u043B\u0430\u0441\u044C." });
  if (!await checkChannelSubs(user.tgId)) return void res.status(403).json({ ok: false, error: "channels_required", message: "\u041F\u043E\u0434\u043F\u0438\u0448\u0438\u0442\u0435\u0441\u044C \u043D\u0430 \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u043A\u0430\u043D\u0430\u043B\u044B \u0432 \u0431\u043E\u0442\u0435 Fracs." });
  if (user.tgId !== config.adminTgId && !await rateLimit(`maps-cooldown:${user.id}`, 1, 6 * 60 * 6e4)) {
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
  if (!await checkChannelSubs(user.tgId)) return void res.status(403).json({ ok: false, error: "channels_required", message: "\u041F\u043E\u0434\u043F\u0438\u0448\u0438\u0442\u0435\u0441\u044C \u043D\u0430 \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u043A\u0430\u043D\u0430\u043B\u044B \u0432 \u0431\u043E\u0442\u0435 Fracs." });
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
var OR_MODELS_TTL = 10 * 6e4;
function orAuthKey(req) {
  const h5 = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (h5) return h5;
  const k = req.body?.key;
  return typeof k === "string" ? k.trim() : "";
}
async function fracsAiGate(req) {
  const raw = orAuthKey(req);
  const uid = raw.length <= 256 ? parseKey(raw) : null;
  if (!uid) return { error: [401, { ok: false, reason: "invalid" }] };
  const user = await getUser(uid);
  if (!user) return { error: [401, { ok: false, reason: "invalid" }] };
  if (!isSubscribed(user)) return { error: [402, { ok: false, reason: "expired" }] };
  if (!await checkChannelSubs(user.tgId)) return { error: [403, { ok: false, reason: "channels_required" }] };
  const features = await getActiveFeatures(user);
  if (!features.includes("fracs_ai") && !features.includes("ai")) {
    return { error: [402, { ok: false, error: "fracs_ai_required", message: "Fracs AI \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u043D\u0430 \u0442\u0430\u0440\u0438\u0444\u0435 Ultra. \u041E\u0444\u043E\u0440\u043C\u0438\u0442\u0435 Ultra \u0432 \u043A\u0430\u0431\u0438\u043D\u0435\u0442\u0435." }] };
  }
  return { user };
}
var envNum = (k, d) => {
  const n = Number(process.env[k]);
  return Number.isFinite(n) && n > 0 ? n : d;
};
var AI_LIMITS = {
  perMinute: envNum("AI_USER_PER_MIN", 40),
  // всплеск: не больше N запросов в минуту
  perHour: envNum("AI_USER_PER_HOUR", 300),
  // …в час (щедро для чата и генератора фраз)
  dailyComplexity: envNum("AI_DAILY_COMPLEXITY", 250),
  // бюджет сложности сайтов/чата на окно
  dailyPhrases: envNum("AI_DAILY_PHRASES", 500),
  // отдельный щедрый лимит для генерации фраз Telegram
  perDayWindowMs: envNum("AI_USER_DAY_WINDOW_MS", 10 * 36e5),
  // окно сброса — 10 часов
  dailyTokens: envNum("AI_DAILY_TOKENS", 25e5),
  // увеличенная включённая дневная квота токенов
  userDailyUsd: envNum("AI_USER_DAILY_USD", 20),
  // потолок расходов на бесплатной дневной квоте
  globalDailyUsd: envNum("AI_GLOBAL_DAILY_USD", 250),
  // аварийный предохранитель: общий бюджет в сутки
  maxTokens: envNum("AI_MAX_TOKENS", 12e3),
  // потолок ответа модели
  maxInputChars: envNum("AI_MAX_INPUT_CHARS", 1e5),
  // правка макета шлёт страницу целиком + дизайн-промт + бриф
  maxImages: 3
};
var DESIGN_MARKER = "DESIGN_SYSTEM_VERSION:";
var isOllamaActive = () => config.fracsAiBackend === "ollama" ? Boolean(config.ollamaApiKey) : config.fracsAiBackend === "openrouter" ? false : Boolean(config.ollamaApiKey);
var hasAnyAiKey = () => Boolean(config.ollamaApiKey || config.openrouterApiKey || config.cohereApiKey || config.qwenApiKey);
var COHERE_MODEL = "command-a-03-2025";
var FRACS_BUILD_MODEL = (process.env.FRACS_AI_BUILD_MODEL || (isOllamaActive() ? "kimi-k2.7-code" : "anthropic/claude-sonnet-4")).trim();
var FRACS_FAST_MODEL = (process.env.FRACS_AI_FAST_MODEL || (isOllamaActive() ? "deepseek-v4.1-flash:1017" : "deepseek/deepseek-chat")).trim();
var FRACS_EDIT_MODEL = config.cohereApiKey || config.openrouterApiKey && !isOllamaActive() ? COHERE_MODEL : FRACS_FAST_MODEL;
var FRACS_MODEL_ALIASES = {
  "fracs-ai": FRACS_BUILD_MODEL,
  "fracs-ai-build": FRACS_BUILD_MODEL,
  "fracs-ai-pro": FRACS_BUILD_MODEL,
  auto: FRACS_BUILD_MODEL,
  "fracs-ai-fast": FRACS_FAST_MODEL,
  "fracs-ai-chat": FRACS_FAST_MODEL,
  "fracs-ai-edit": FRACS_EDIT_MODEL,
  "fracs-ai-copy": FRACS_EDIT_MODEL
};
var AI_MODELS = new Set((process.env.AI_ALLOWED_MODELS || "anthropic/claude-sonnet-4,anthropic/claude-3.5-sonnet,google/gemini-2.5-flash,kimi-k2.7-code,deepseek-v4-pro:0813,deepseek-v4.1-flash:1017,deepseek-v4.1-flash,glm-5.3,glm-5.3-flash,gemma4:31b,kimi-k3.1-pro,mistral-large-4,minimax-m3.1-flash,anthropic/claude-sonnet-5.5,openai/gpt-5.6-terra-pro,deepseek/deepseek-v4-pro-0813,deepseek/deepseek-v4.1-flash-1017,openai/gpt-4o-mini,anthropic/claude-3.5-haiku,google/gemini-2.0-flash-001,meta-llama/llama-3.3-70b-instruct,deepseek/deepseek-chat,qwen/qwen-2.5-72b-instruct,command-a-03-2025").split(",").map((s) => s.trim()).filter(Boolean));
var AI_PRICE = {
  // Ollama Cloud (для внутреннего учёта квот)
  "kimi-k2.7-code": [0.3, 1.2],
  "deepseek-v4-pro:0813": [0.15, 0.8],
  "deepseek-v4.1-flash:1017": [0.1, 0.4],
  "deepseek-v4.1-flash": [0.1, 0.4],
  "glm-5.3": [0.2, 0.8],
  "glm-5.3-flash": [0.1, 0.4],
  "gemma4:31b": [0.1, 0.3],
  "kimi-k3.1-pro": [0.3, 1.2],
  "mistral-large-4": [0.3, 1.2],
  "minimax-m3.1-flash": [0.1, 0.4],
  // премиум-кодинг (генерация сайтов, OpenRouter)
  "anthropic/claude-sonnet-4": [3, 15],
  "anthropic/claude-3.5-sonnet": [3, 15],
  "google/gemini-2.5-flash": [0.15, 0.6],
  "anthropic/claude-sonnet-5.5": [2, 10],
  "openai/gpt-5.6-terra-pro": [2, 12],
  "deepseek/deepseek-v4-pro-0813": [0.1, 5],
  "deepseek/deepseek-v4.1-flash-1017": [0.15, 0.6],
  // бюджетные (чат/фразы)
  "openai/gpt-4o-mini": [0.15, 0.6],
  "anthropic/claude-3.5-haiku": [0.8, 4],
  "google/gemini-2.0-flash-001": [0.1, 0.4],
  "meta-llama/llama-3.3-70b-instruct": [0.12, 0.3],
  "deepseek/deepseek-chat": [0.3, 0.9],
  "qwen/qwen-2.5-72b-instruct": [0.12, 0.39],
  // Cohere Command A: $2.5 / $10 за 1M токенов, контекст 256K, но не больше 8000 токенов ответа
  "command-a-03-2025": [2.5, 10],
  // Qwen Model Studio (ориентировочно, для учёта квот; уточните в консоли Alibaba Cloud)
  [config.qwenModel]: [0.4, 1.2]
};
var COHERE_VIA_OR = "cohere/command-a";
var COHERE_MAX_OUT = 8e3;
var MODELS_NO_TEMP = /* @__PURE__ */ new Set([
  "anthropic/claude-sonnet-5.5",
  "openai/gpt-5.6-terra-pro"
]);
var MODELS_LOW_REASONING = /* @__PURE__ */ new Set([
  "anthropic/claude-sonnet-5.5",
  "openai/gpt-5.6-terra-pro"
]);
var isQwenModel = (m) => m === config.qwenModel;
function prepareUpstreamBody(baseBody, targetModel, stripExtra = false) {
  const out = { ...baseBody, model: targetModel };
  if (MODELS_NO_TEMP.has(targetModel) || stripExtra) {
    delete out.temperature;
  }
  if (!stripExtra && MODELS_LOW_REASONING.has(targetModel) && !out.reasoning) {
    out.reasoning = { effort: "low" };
  } else if (stripExtra) {
    delete out.reasoning;
    delete out.usage;
  }
  return out;
}
function buildFallbackModels(primaryModel, imageCount) {
  const list = [primaryModel];
  if (isOllamaActive()) {
    if (primaryModel === COHERE_MODEL) {
      list.push(FRACS_FAST_MODEL, "glm-5.3-flash");
    } else if (primaryModel === FRACS_BUILD_MODEL) {
      const olFallbacks = config.openrouterApiKey ? ["deepseek-v4.1-flash:1017", ...imageCount > 0 ? [] : ["deepseek-v4-pro:0813"]] : imageCount > 0 ? ["deepseek-v4.1-flash:1017", "glm-5.3-flash", "mistral-large-4"] : ["deepseek-v4.1-flash:1017", "glm-5.3-flash", "deepseek-v4-pro:0813", "glm-5.3"];
      list.push(...olFallbacks);
    } else if (primaryModel === FRACS_FAST_MODEL) {
      list.push("glm-5.3-flash", "gemma4:31b", "minimax-m3.1-flash");
    }
  }
  if (config.openrouterApiKey) {
    if (primaryModel === COHERE_MODEL) {
      list.push("deepseek/deepseek-chat", "google/gemini-2.5-flash", "openai/gpt-4o-mini");
    } else if (primaryModel === FRACS_FAST_MODEL || primaryModel === "deepseek/deepseek-chat") {
      list.push("deepseek/deepseek-chat", "google/gemini-2.5-flash", "openai/gpt-4o-mini", "anthropic/claude-3.5-haiku");
    } else {
      list.push(...imageCount > 0 ? ["google/gemini-2.5-flash", "anthropic/claude-sonnet-4", "anthropic/claude-3.5-sonnet", "openai/gpt-4o-mini"] : ["google/gemini-2.5-flash", "deepseek/deepseek-chat", "anthropic/claude-sonnet-4", "anthropic/claude-3.5-sonnet", "openai/gpt-4o-mini"]);
    }
  }
  if (config.qwenApiKey) list.push(config.qwenModel);
  return interleaveByProvider(Array.from(new Set(list)));
}
var providerDownUntil = {};
var isProviderDown = (v) => (providerDownUntil[v] || 0) > Date.now();
function markProviderFailure(v, status) {
  const ms = status === 401 || status === 402 || status === 403 ? 10 * 6e4 : status === 429 ? 3e4 : 6e4;
  providerDownUntil[v] = Date.now() + ms;
  console.warn(`[ai] \u043F\u0440\u043E\u0432\u0430\u0439\u0434\u0435\u0440 ${v} \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E \u043E\u0442\u043A\u043B\u044E\u0447\u0451\u043D \u043D\u0430 ${Math.round(ms / 1e3)} \u0441 (status ${status})`);
}
var markProviderOk = (v) => {
  delete providerDownUntil[v];
};
var failReason = (status) => status === 401 || status === 403 ? "auth" : status === 402 ? "billing" : status === 429 ? "rate" : status === 599 ? "timeout" : status >= 500 ? "server" : status === 0 ? "empty" : "rejected";
function interleaveByProvider(models) {
  if (models.length < 3) return models;
  const [primary, ...rest] = models;
  const viaOf = (m) => resolveUpstream({ model: m, messages: [], max_tokens: 1 }, false, m, false)?.via || "none";
  const groups = /* @__PURE__ */ new Map();
  for (const m of rest) {
    const via = viaOf(m);
    if (via === "none") continue;
    if (!groups.has(via)) groups.set(via, []);
    groups.get(via).push(m);
  }
  const primaryVia = viaOf(primary);
  const order = [...groups.keys()].sort((a, b) => (a === primaryVia ? 1 : 0) - (b === primaryVia ? 1 : 0));
  const out = [primary];
  for (let round = 0; out.length < models.length; round++) {
    let added = false;
    for (const k of order) {
      const m = groups.get(k)[round];
      if (m) {
        out.push(m);
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}
function hasNonEmptyCompletion(parsed) {
  const ch = parsed?.choices?.[0];
  if (!ch) return false;
  const c = ch?.message?.content;
  if (typeof c === "string") return c.trim().length > 0;
  if (Array.isArray(c)) {
    return c.some((b) => b?.type === "text" && typeof b?.text === "string" && b.text.trim().length > 0);
  }
  return typeof ch?.text === "string" && ch.text.trim().length > 0;
}
function resolveUpstream(body, forceOpenRouter = false, overrideModel, stripExtra = false) {
  const target = overrideModel || body.model;
  if (isQwenModel(target)) {
    if (!config.qwenApiKey) return null;
    const qBody = prepareUpstreamBody(body, target, stripExtra);
    delete qBody.usage;
    delete qBody.reasoning;
    return { url: config.qwenUrl + "/chat/completions", key: config.qwenApiKey, body: qBody, via: "qwen", model: target };
  }
  if (target === COHERE_MODEL) {
    if (config.cohereApiKey && !forceOpenRouter) {
      const direct = prepareUpstreamBody(body, COHERE_MODEL, stripExtra);
      delete direct.usage;
      direct.max_tokens = Math.min(Number(direct.max_tokens) || COHERE_MAX_OUT, COHERE_MAX_OUT);
      return { url: config.cohereUrl + "/chat/completions", key: config.cohereApiKey, body: direct, via: "cohere", model: COHERE_MODEL };
    }
    if (config.openrouterApiKey) {
      const orBody = prepareUpstreamBody(body, COHERE_VIA_OR, stripExtra);
      orBody.max_tokens = Math.min(Number(orBody.max_tokens) || COHERE_MAX_OUT, COHERE_MAX_OUT);
      return { url: config.openrouterUrl + "/chat/completions", key: config.openrouterApiKey, body: orBody, via: "openrouter", model: COHERE_VIA_OR };
    }
    if (config.ollamaApiKey) {
      const olModel = isOllamaActive() ? FRACS_FAST_MODEL : "deepseek-v4.1-flash:1017";
      const olBody = prepareUpstreamBody(body, olModel, stripExtra);
      delete olBody.usage;
      olBody.max_tokens = Math.min(Number(olBody.max_tokens) || COHERE_MAX_OUT, COHERE_MAX_OUT);
      return { url: config.ollamaUrl + "/chat/completions", key: config.ollamaApiKey, body: olBody, via: "ollama", model: olModel };
    }
    if (config.qwenApiKey) {
      const qBody = prepareUpstreamBody(body, config.qwenModel, stripExtra);
      delete qBody.usage;
      delete qBody.reasoning;
      qBody.max_tokens = Math.min(Number(qBody.max_tokens) || COHERE_MAX_OUT, COHERE_MAX_OUT);
      return { url: config.qwenUrl + "/chat/completions", key: config.qwenApiKey, body: qBody, via: "qwen", model: config.qwenModel };
    }
    return null;
  }
  const preferOllama = isOllamaActive() || !config.openrouterApiKey && Boolean(config.ollamaApiKey);
  if (preferOllama && config.ollamaApiKey && !target.includes("/")) {
    const olBody = prepareUpstreamBody(body, target, stripExtra);
    delete olBody.usage;
    return { url: config.ollamaUrl + "/chat/completions", key: config.ollamaApiKey, body: olBody, via: "ollama", model: target };
  }
  if (config.openrouterApiKey) {
    const orBody = prepareUpstreamBody(body, target, stripExtra);
    return { url: config.openrouterUrl + "/chat/completions", key: config.openrouterApiKey, body: orBody, via: "openrouter", model: target };
  }
  if (config.ollamaApiKey) {
    const fallbackOllamaModel = target.includes("/") ? "kimi-k2.7-code" : target;
    const olBody = prepareUpstreamBody(body, fallbackOllamaModel, stripExtra);
    delete olBody.usage;
    return { url: config.ollamaUrl + "/chat/completions", key: config.ollamaApiKey, body: olBody, via: "ollama", model: fallbackOllamaModel };
  }
  if (config.qwenApiKey) {
    const qBody = prepareUpstreamBody(body, config.qwenModel, stripExtra);
    delete qBody.usage;
    delete qBody.reasoning;
    return { url: config.qwenUrl + "/chat/completions", key: config.qwenApiKey, body: qBody, via: "qwen", model: config.qwenModel };
  }
  return null;
}
var FRACS_TASKS = /* @__PURE__ */ new Set(["copy", "critique", "build"]);
var priceOf = (model) => AI_PRICE[model] || [1, 4];
var aiErr = (status, error, message, extra = {}) => [status, { ok: false, error, message, ...extra }];
function detectSiteBuild(messages, maxTokens, imageCount) {
  if (imageCount > 0 || maxTokens > 2200) return true;
  for (const m of messages) {
    const txt = typeof m?.content === "string" ? m.content : Array.isArray(m?.content) ? m.content.map((p) => p?.text || "").join("\n") : "";
    if (/DESIGN_SYSTEM_VERSION:|СТИЛЕВОЙ РЕЦЕПТ|СТИЛЕВОЕ НАПРАВЛЕНИЕ|ТИПОГРАФИКА|текущая-версия-сайта\.html|<!DOCTYPE|<html/i.test(txt)) {
      return true;
    }
  }
  return false;
}
function detectPhraseGen(messages, maxTokens, inChars, isSiteBuild) {
  if (isSiteBuild || maxTokens > 2e3 || inChars > 4e3) return false;
  const full = messages.map((m) => typeof m?.content === "string" ? m.content : "").join("\n");
  return /поисковую фразу|парсингу заявок в Telegram|Исходная фраза:/i.test(full);
}
function assessAiComplexity(maxTokens, inChars, imageCount, isSiteBuild, isPhraseGen) {
  if (isPhraseGen && imageCount === 0) {
    return {
      points: 0,
      tier: "phrase",
      label: "\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F \u0444\u0440\u0430\u0437",
      reserveOutputTokens: Math.min(maxTokens, 1200)
    };
  }
  if (!isSiteBuild && imageCount === 0 && inChars < 5500 && maxTokens <= 2200) {
    return {
      points: 1,
      tier: "light",
      label: "\u041B\u0451\u0433\u043A\u0430\u044F",
      reserveOutputTokens: Math.min(maxTokens, 1600)
    };
  }
  if (inChars < 4500 && maxTokens <= 5e3 && imageCount === 0 || !isSiteBuild && imageCount === 0) {
    return {
      points: 2,
      tier: "medium",
      label: "\u0421\u0440\u0435\u0434\u043D\u044F\u044F",
      reserveOutputTokens: Math.min(maxTokens, 5500)
    };
  }
  const extraSize = inChars > 14e3 ? 1 : 0;
  return {
    points: Math.min(10, 4 + imageCount * 2 + extraSize),
    tier: "heavy",
    label: "\u0421\u043B\u043E\u0436\u043D\u0430\u044F",
    reserveOutputTokens: maxTokens
  };
}
function sanitizeAiBody(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { err: aiErr(400, "bad_request", "\u041E\u0436\u0438\u0434\u0430\u0435\u0442\u0441\u044F \u0442\u0435\u043B\u043E chat/completions.") };
  const rawModel = String(raw.model || "").trim() || "fracs-ai";
  const model = FRACS_MODEL_ALIASES[rawModel] || rawModel;
  if (!FRACS_MODEL_ALIASES[rawModel] && !AI_MODELS.has(model)) return { err: aiErr(400, "model_not_allowed", "\u042D\u0442\u0430 \u043C\u043E\u0434\u0435\u043B\u044C \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430 \u0432\u043E \u0432\u0441\u0442\u0440\u043E\u0435\u043D\u043D\u043E\u043C Fracs AI. \u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439\u0442\u0435 \u0432\u0441\u0442\u0440\u043E\u0435\u043D\u043D\u044B\u0439 \u0440\u0435\u0436\u0438\u043C Fracs AI \u0438\u043B\u0438 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u0435 \u0441\u0432\u043E\u0439 API-\u043A\u043B\u044E\u0447.") };
  const msgs = raw.messages;
  if (!Array.isArray(msgs) || msgs.length < 1 || msgs.length > 12) return { err: aiErr(400, "bad_request", "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 \u0441\u043F\u0438\u0441\u043E\u043A \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439.") };
  let chars = 0, images = 0;
  const messages = [];
  for (const m of msgs) {
    const role = String(m?.role || "");
    if (!["system", "user", "assistant"].includes(role)) return { err: aiErr(400, "bad_request", "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u0430\u044F \u0440\u043E\u043B\u044C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F.") };
    if (typeof m.content === "string") {
      chars += m.content.length;
      messages.push({ role, content: m.content });
    } else if (Array.isArray(m.content)) {
      const parts = [];
      for (const p of m.content) {
        if (p?.type === "text" && typeof p.text === "string") {
          chars += p.text.length;
          parts.push({ type: "text", text: p.text });
        } else if (p?.type === "image_url" && typeof p.image_url?.url === "string" && /^data:image\/(png|jpe?g|webp);base64,/i.test(p.image_url.url)) {
          if (++images > AI_LIMITS.maxImages) return { err: aiErr(400, "too_many_images", `\u041D\u0435 \u0431\u043E\u043B\u044C\u0448\u0435 ${AI_LIMITS.maxImages} \u043A\u0430\u0440\u0442\u0438\u043D\u043E\u043A \u0432 \u0437\u0430\u043F\u0440\u043E\u0441\u0435.`) };
          parts.push({ type: "image_url", image_url: { url: p.image_url.url } });
        } else return { err: aiErr(400, "bad_request", "\u041D\u0435\u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u043C\u044B\u0439 \u0442\u0438\u043F \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0433\u043E.") };
      }
      messages.push({ role, content: parts });
    } else return { err: aiErr(400, "bad_request", "\u041F\u0443\u0441\u0442\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435.") };
  }
  if (model === COHERE_MODEL && images > 0) return { err: aiErr(400, "no_vision", "\u042D\u0442\u0430 \u043C\u043E\u0434\u0435\u043B\u044C \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0441 \u0442\u0435\u043A\u0441\u0442\u043E\u043C.") };
  if (chars > AI_LIMITS.maxInputChars) return { err: aiErr(413, "input_too_long", `\u0417\u0430\u043F\u0440\u043E\u0441 \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0434\u043B\u0438\u043D\u043D\u044B\u0439 (\u043B\u0438\u043C\u0438\u0442 ${AI_LIMITS.maxInputChars} \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432). \u0421\u043E\u043A\u0440\u0430\u0442\u0438\u0442\u0435 \u043F\u0440\u043E\u043C\u0442 \u0438\u043B\u0438 \u0432\u043B\u043E\u0436\u0435\u043D\u0438\u044F.`) };
  const reqTok = Number(raw.max_tokens);
  const capTokens = model === COHERE_MODEL ? Math.min(AI_LIMITS.maxTokens, COHERE_MAX_OUT) : AI_LIMITS.maxTokens;
  const maxTokens = Math.min(capTokens, Number.isFinite(reqTok) && reqTok > 0 ? Math.floor(reqTok) : capTokens);
  const temp = Number(raw.temperature);
  const outBody = { model, messages, max_tokens: maxTokens, stream: false, usage: { include: true } };
  if (!MODELS_NO_TEMP.has(model)) {
    outBody.temperature = Number.isFinite(temp) ? Math.min(model === COHERE_MODEL ? 1 : 1.2, Math.max(0, temp)) : 0.7;
  }
  return {
    inChars: chars,
    imageCount: images,
    body: outBody,
    task: FRACS_TASKS.has(String(raw.fracs_task)) ? String(raw.fracs_task) : "",
    rawModel
  };
}
appRouter.post("/ai", h2(async (req, res) => {
  const rawKey = orAuthKey(req);
  const preUid = rawKey.length <= 256 ? parseKey(rawKey) : null;
  if (!preUid && !await rateLimit(`app-ai-bad:${req.ip}`, 60, 10 * 6e4, true)) {
    return void res.status(429).json({ ok: false, reason: "rate_limited" });
  }
  const gate2 = await fracsAiGate(req);
  if ("error" in gate2) return void res.status(gate2.error[0]).json(gate2.error[1]);
  const isAdmin = isAdminTg(gate2.user.tgId);
  if (!isAdmin && !await rateLimit(`app-ai:${req.ip}`, 360, 10 * 6e4, true)) {
    return void res.status(429).json({ ok: false, reason: "rate_limited" });
  }
  if (!hasAnyAiKey()) {
    return void res.status(503).json({ ok: false, error: "not_configured", message: "Fracs AI \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435." });
  }
  const uid = String(gate2.user.id);
  const clean = sanitizeAiBody(req.body?.body ?? req.body);
  if ("err" in clean) return void res.status(clean.err[0]).json(clean.err[1]);
  const { body, inChars, imageCount } = clean;
  if (!resolveUpstream(body)) {
    return void res.status(503).json({ ok: false, error: "not_configured", message: "Fracs AI \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435." });
  }
  const cheapTask = (clean.task === "copy" || clean.task === "critique") && imageCount === 0 && body.max_tokens <= COHERE_MAX_OUT && (body.model === COHERE_MODEL || clean.rawModel === "fracs-ai-edit" || clean.rawModel === "fracs-ai-copy");
  const isSiteBuild = cheapTask ? false : detectSiteBuild(body.messages, body.max_tokens, imageCount);
  const isPhraseGen = detectPhraseGen(body.messages, body.max_tokens, inChars, isSiteBuild);
  const complexity = cheapTask ? { points: 1, tier: "light", label: clean.task === "copy" ? "\u0422\u0435\u043A\u0441\u0442\u044B \u0438 \u043A\u043E\u043D\u0446\u0435\u043F\u0446\u0438\u044F" : "\u0412\u044B\u0447\u0438\u0442\u043A\u0430", reserveOutputTokens: Math.min(body.max_tokens, 4500) } : assessAiComplexity(body.max_tokens, inChars, imageCount, isSiteBuild, isPhraseGen);
  let designChars = 0;
  const hasDesign = body.messages.some((m) => m.role === "system" && typeof m.content === "string" && m.content.includes(DESIGN_MARKER));
  if (isSiteBuild && !hasDesign) {
    const sys = `DESIGN_SYSTEM_VERSION: ${DESIGN_VERSION}
` + FRACS_DESIGN_SYSTEM;
    body.messages.unshift({ role: "system", content: sys });
    designChars = sys.length;
  }
  const totalInChars = inChars + designChars;
  if (!isAdmin) {
    if (!await rateLimit(`ai-u-min:${uid}`, AI_LIMITS.perMinute, 6e4, true)) {
      return void res.status(429).json({ ok: false, error: "quota_minute", resetAt: Date.now() + 6e4, message: "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u0447\u0430\u0441\u0442\u044B\u0435 \u0437\u0430\u043F\u0440\u043E\u0441\u044B. \u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435 \u043C\u0438\u043D\u0443\u0442\u0443 \u0438 \u043F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435." });
    }
    if (!await rateLimit(`ai-u-hr:${uid}`, AI_LIMITS.perHour, 36e5, true)) {
      return void res.status(429).json({ ok: false, error: "quota_hour", resetAt: Date.now() + 36e5, message: `\u041B\u0438\u043C\u0438\u0442 Fracs AI: ${AI_LIMITS.perHour} \u043E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u0439 \u0432 \u0447\u0430\u0441. \u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u0435 \u043F\u043E\u0437\u0436\u0435 \u0438\u043B\u0438 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u0435 \u0441\u0432\u043E\u0439 API-\u043A\u043B\u044E\u0447 \u2014 \u0431\u0435\u0437 \u043B\u0438\u043C\u0438\u0442\u043E\u0432.` });
    }
  }
  let balance = 0;
  let usage = { userRequests: 0, userCostUsd: 0, userTokens: 0, totalRequests: 0, totalCostUsd: 0, totalTokens: 0 };
  if (isAdmin) {
    [usage, balance] = await Promise.all([aiUsageToday(uid).catch(() => usage), aiTokensGet(uid).catch(() => 0)]);
  } else {
    try {
      [usage, balance] = await Promise.all([aiUsageToday(uid), aiTokensGet(uid)]);
    } catch (e) {
      console.error("[ai] usage/tokens read failed \u2014 \u0437\u0430\u043F\u0440\u043E\u0441 \u043E\u0442\u043A\u043B\u043E\u043D\u0451\u043D (\u043F\u0440\u0435\u0434\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u0435\u043B\u044C):", e);
      return void res.status(503).json({ ok: false, error: "budget_unavailable", message: "Fracs AI \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435 \u0438\u043B\u0438 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439\u0442\u0435 \u0441\u0432\u043E\u0439 API-\u043A\u043B\u044E\u0447." });
    }
  }
  const cxKey = isPhraseGen ? `ai-phrase-day:${uid}` : `ai-cx-day:${uid}`;
  const cxCost = isPhraseGen ? 1 : complexity.points;
  const cxLimit = isPhraseGen ? AI_LIMITS.dailyPhrases : AI_LIMITS.dailyComplexity;
  let cxUsed = 0;
  let cxConsumed = false;
  let cxResetAt = 0;
  if (!isAdmin && balance <= 0) {
    const cx = await consumeBudgetWindow(cxKey, cxCost, cxLimit, AI_LIMITS.perDayWindowMs, true);
    cxUsed = cx.used;
    cxResetAt = cx.resetAt || Date.now() + AI_LIMITS.perDayWindowMs;
    if (!cx.allowed) {
      const hours = Math.max(1, Math.round((cxResetAt - Date.now()) / 36e5));
      return void res.status(429).json({
        ok: false,
        error: "quota_day",
        complexity,
        complexityUsed: cx.used,
        complexityLimit: cxLimit,
        resetAt: cxResetAt,
        message: isPhraseGen ? `\u0414\u043D\u0435\u0432\u043D\u043E\u0439 \u043B\u0438\u043C\u0438\u0442 \u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u0438 \u0444\u0440\u0430\u0437 Telegram \u0438\u0441\u0447\u0435\u0440\u043F\u0430\u043D (${cx.used}/${cxLimit}). \u041E\u043D \u043E\u0431\u043D\u043E\u0432\u0438\u0442\u0441\u044F \u0447\u0435\u0440\u0435\u0437 ${hours} \u0447 \u2014 \u0438\u043B\u0438 \u0434\u043E\u043A\u0443\u043F\u0438\u0442\u0435 \u0442\u043E\u043A\u0435\u043D\u044B \u043F\u0440\u044F\u043C\u043E \u0432 \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0435.` : `\u041B\u0438\u043C\u0438\u0442 \u0441\u043B\u043E\u0436\u043D\u043E\u0441\u0442\u0438 Fracs AI \u0438\u0441\u0447\u0435\u0440\u043F\u0430\u043D (${cx.used}/${cxLimit} \u0435\u0434.; \u0437\u0430\u0434\u0430\u0447\u0430 \xAB${complexity.label}\xBB \u0442\u0440\u0435\u0431\u0443\u0435\u0442 ${cxCost} \u0435\u0434.). \u041E\u043D \u043E\u0431\u043D\u043E\u0432\u0438\u0442\u0441\u044F \u0447\u0435\u0440\u0435\u0437 ${hours} \u0447 \u2014 \u0438\u043B\u0438 \u0434\u043E\u043A\u0443\u043F\u0438\u0442\u0435 \u0442\u043E\u043A\u0435\u043D\u044B \u043F\u0440\u044F\u043C\u043E \u0432 \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0435.`,
        buyUrl: `${config.appUrl}/app`
      });
    }
    cxConsumed = true;
  }
  const worstTokens = Math.round(totalInChars / 3.5) + complexity.reserveOutputTokens;
  const tokensAllowed = AI_LIMITS.dailyTokens + balance;
  if (!isAdmin && usage.userTokens + worstTokens > tokensAllowed) {
    if (cxConsumed) await refundBudgetWindow(cxKey, cxCost);
    const left = Math.max(0, tokensAllowed - usage.userTokens);
    const nextUtcMidnight = /* @__PURE__ */ new Date();
    nextUtcMidnight.setUTCHours(24, 0, 0, 0);
    return void res.status(429).json({
      ok: false,
      error: "quota_tokens",
      resetAt: nextUtcMidnight.getTime(),
      message: `\u0414\u043D\u0435\u0432\u043D\u043E\u0439 \u043B\u0438\u043C\u0438\u0442 \u0442\u043E\u043A\u0435\u043D\u043E\u0432 Fracs AI \u0438\u0441\u0447\u0435\u0440\u043F\u0430\u043D (\u0432\u043A\u043B\u044E\u0447\u0435\u043D\u043E ${AI_LIMITS.dailyTokens.toLocaleString("ru-RU")}/\u0441\u0443\u0442\u043A\u0438). \u0414\u043E\u043A\u0443\u043F\u0438\u0442\u0435 \u0442\u043E\u043A\u0435\u043D\u044B \u043F\u0440\u044F\u043C\u043E \u0432 \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0435 \u2014 \u043E\u043D\u0438 \u043D\u0435 \u0438\u0441\u0442\u0435\u043A\u0430\u044E\u0442.`,
      tokensLeft: left,
      buyUrl: `${config.appUrl}/app`
    });
  }
  const [pin, pout] = priceOf(body.model);
  const worstUsd = totalInChars / 3.5 * pin / 1e6 + complexity.reserveOutputTokens * pout / 1e6;
  if (!isAdmin && usage.totalCostUsd + worstUsd > AI_LIMITS.globalDailyUsd) {
    if (cxConsumed) await refundBudgetWindow(cxKey, cxCost);
    return void res.status(503).json({ ok: false, error: "daily_budget", message: "\u041E\u0431\u0449\u0438\u0439 \u043B\u0438\u043C\u0438\u0442 Fracs AI \u043D\u0430 \u0441\u0435\u0433\u043E\u0434\u043D\u044F \u0438\u0441\u0447\u0435\u0440\u043F\u0430\u043D \u2014 \u043E\u043D \u043E\u0431\u043D\u043E\u0432\u0438\u0442\u0441\u044F \u0437\u0430\u0432\u0442\u0440\u0430. \u0421\u043E \u0441\u0432\u043E\u0438\u043C API-\u043A\u043B\u044E\u0447\u043E\u043C \u043C\u043E\u0436\u043D\u043E \u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u0431\u0435\u0437 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0438\u0439." });
  }
  if (!isAdmin && balance <= 0 && usage.userCostUsd + worstUsd > AI_LIMITS.userDailyUsd) {
    if (cxConsumed) await refundBudgetWindow(cxKey, cxCost);
    const nextUtcMidnight = /* @__PURE__ */ new Date();
    nextUtcMidnight.setUTCHours(24, 0, 0, 0);
    return void res.status(429).json({ ok: false, error: "quota_budget", resetAt: nextUtcMidnight.getTime(), message: "\u0414\u043D\u0435\u0432\u043D\u043E\u0439 \u043B\u0438\u043C\u0438\u0442 Fracs AI \u043F\u043E \u043E\u0431\u044A\u0451\u043C\u0443 \u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u0438 \u0438\u0441\u0447\u0435\u0440\u043F\u0430\u043D. \u041E\u043D \u043E\u0431\u043D\u043E\u0432\u0438\u0442\u0441\u044F \u0437\u0430\u0432\u0442\u0440\u0430 \u0438\u043B\u0438 \u043F\u043E\u0441\u043B\u0435 \u043F\u043E\u043A\u0443\u043F\u043A\u0438 \u043F\u0430\u043A\u0435\u0442\u0430 \u0442\u043E\u043A\u0435\u043D\u043E\u0432." });
  }
  try {
    const callUpstreamSmart = async (u, overallTimeoutMs, firstTokenTimeoutMs, useStream) => {
      const ac = new AbortController();
      let timerReason = "";
      const overallTimer = setTimeout(() => {
        timerReason = "overall_timeout";
        ac.abort();
      }, overallTimeoutMs);
      let firstTokenTimer = null;
      let idleTimer = null;
      let partial = "";
      const clearTimers = () => {
        clearTimeout(overallTimer);
        if (firstTokenTimer) {
          clearTimeout(firstTokenTimer);
          firstTokenTimer = null;
        }
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
      };
      const reqBody = useStream ? { ...u.body, stream: true, ...u.via === "qwen" ? { stream_options: { include_usage: true } } : {} } : u.body;
      if (useStream && firstTokenTimeoutMs < overallTimeoutMs) {
        firstTokenTimer = setTimeout(() => {
          timerReason = "first_token_timeout";
          ac.abort();
        }, firstTokenTimeoutMs);
      }
      try {
        const r = await fetch(u.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${u.key}` },
          body: JSON.stringify(reqBody),
          signal: ac.signal
        });
        const ctype = (r.headers.get("content-type") || "").toLowerCase();
        if (!r.ok || !useStream || !ctype.includes("text/event-stream") || !r.body) {
          const rawText = await r.text();
          return { status: r.status, rawText };
        }
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let content = "";
        let finishReason = "stop";
        let usageObj = null;
        let gotContent = false;
        const resetIdle = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            timerReason = "stream_idle_timeout";
            ac.abort();
          }, 2e4);
        };
        resetIdle();
        let sawReasoning = false;
        const consumeLine = (line) => {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) return;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") return;
          let ev = null;
          try {
            ev = JSON.parse(payload);
          } catch {
            return;
          }
          if (ev?.error && !content) {
            throw new Error(`stream_error:${ev.error?.message || ev.error?.code || "upstream"}`);
          }
          if (ev?.usage) usageObj = ev.usage;
          const ch = ev?.choices?.[0];
          if (!ch) return;
          if (ch.finish_reason) finishReason = ch.finish_reason;
          const delta = ch.delta;
          if (typeof delta?.content === "string" && delta.content.length > 0) {
            content += delta.content;
            partial = content;
            if (!gotContent) {
              gotContent = true;
              if (firstTokenTimer) {
                clearTimeout(firstTokenTimer);
                firstTokenTimer = null;
              }
            }
          } else if (!gotContent && !sawReasoning && (typeof delta?.reasoning === "string" && delta.reasoning.length > 0 || typeof delta?.reasoning_content === "string" && delta.reasoning_content.length > 0)) {
            sawReasoning = true;
            if (firstTokenTimer) {
              clearTimeout(firstTokenTimer);
              firstTokenTimer = setTimeout(() => {
                timerReason = "first_content_timeout";
                ac.abort();
              }, Math.min(overallTimeoutMs, 24e3));
            }
          }
        };
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          resetIdle();
          buf += decoder.decode(value, { stream: true });
          let nl = buf.indexOf("\n");
          while (nl !== -1) {
            consumeLine(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
            nl = buf.indexOf("\n");
          }
        }
        buf += decoder.decode();
        if (buf.trim()) consumeLine(buf);
        const parsed = {
          id: `fracs-${Date.now()}`,
          object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finishReason }],
          ...usageObj ? { usage: usageObj } : {}
        };
        return { status: r.status, rawText: "", parsed };
      } catch (err) {
        if (partial.length > 1200) {
          console.warn("[ai] \u0441\u0442\u0440\u0438\u043C \u043E\u0431\u043E\u0440\u0432\u0430\u043D (" + (timerReason || err?.message || "error") + "), \u043E\u0442\u0434\u0430\u044E \u0447\u0430\u0441\u0442\u0438\u0447\u043D\u044B\u0439 \u043E\u0442\u0432\u0435\u0442:", partial.length, "\u0441\u0438\u043C\u0432.");
          return {
            status: 200,
            rawText: "",
            parsed: {
              id: `fracs-${Date.now()}`,
              object: "chat.completion",
              choices: [{ index: 0, message: { role: "assistant", content: partial }, finish_reason: "length" }]
            }
          };
        }
        if (timerReason) throw new Error(timerReason);
        throw err;
      } finally {
        clearTimers();
      }
    };
    const candidates = buildFallbackModels(body.model, imageCount);
    const reasons = /* @__PURE__ */ new Set();
    const anyProviderUp = candidates.some((c) => {
      const u = resolveUpstream(body, false, c, false);
      return !!u && !isProviderDown(u.via);
    });
    const isVercel = Boolean(process.env.VERCEL);
    const deadline = Date.now() + envNum("AI_DEADLINE_MS", isVercel ? 55e3 : 155e3);
    let okUpstream = null;
    let lastStatus = 502;
    for (let idx = 0; idx < candidates.length; idx++) {
      const remaining = deadline - Date.now();
      if (remaining <= 3e3) break;
      const candidate = candidates[idx];
      const hasMore = idx + 1 < candidates.length;
      const overallMs = isVercel ? remaining : Math.min(remaining, hasMore ? 75e3 : remaining);
      const firstTokMs = isVercel ? hasMore ? Math.min(remaining - 2e3, idx === 0 ? 15e3 : 13e3) : remaining : hasMore ? 22e3 : remaining;
      const attempts = [];
      const u1 = resolveUpstream(body, false, candidate, false);
      if (u1) attempts.push(u1);
      if (candidate === COHERE_MODEL && config.cohereApiKey && config.openrouterApiKey) {
        const uOr = resolveUpstream(body, true, candidate, false);
        if (uOr) attempts.push(uOr);
      }
      for (const route of attempts) {
        if (anyProviderUp && isProviderDown(route.via)) {
          console.warn("[ai] \u043F\u0440\u043E\u043F\u0443\u0441\u043A\u0430\u044E", route.via, "\u2014 \u043F\u0440\u043E\u0432\u0430\u0439\u0434\u0435\u0440 \u043D\u0435\u0434\u0430\u0432\u043D\u043E \u043F\u0430\u0434\u0430\u043B");
          continue;
        }
        const canStream = route.via === "openrouter" || route.via === "ollama" || route.via === "qwen";
        try {
          let resUp = await callUpstreamSmart(route, overallMs, Math.max(4e3, firstTokMs), canStream);
          if (resUp.status === 400 || resUp.status === 422) {
            const safeMaxTok = Math.min(Number(route.body.max_tokens) || 8192, 8192);
            const stripped = resolveUpstream(
              { ...body, max_tokens: safeMaxTok },
              route.via === "openrouter" && candidate === COHERE_MODEL,
              candidate,
              true
            );
            if (stripped) {
              const rem2 = Math.max(4e3, deadline - Date.now());
              resUp = await callUpstreamSmart(stripped, rem2, Math.min(rem2, firstTokMs), canStream);
            }
          }
          if (resUp.status === 402 && !hasMore && (Number(route.body.max_tokens) || 0) > 6144) {
            const capped = resolveUpstream(
              { ...body, max_tokens: 6144 },
              route.via === "openrouter" && candidate === COHERE_MODEL,
              candidate,
              true
            );
            if (capped) {
              const rem2 = Math.max(4e3, deadline - Date.now());
              resUp = await callUpstreamSmart(capped, rem2, rem2, canStream);
            }
          }
          lastStatus = resUp.status;
          if (!(resUp.status >= 200 && resUp.status < 300)) {
            if ([401, 402, 403, 429].includes(resUp.status) || resUp.status >= 500) {
              markProviderFailure(route.via, resUp.status);
              reasons.add(failReason(resUp.status));
            }
          }
          if (resUp.status >= 200 && resUp.status < 300) {
            try {
              const parsed = resUp.parsed ?? JSON.parse(resUp.rawText);
              if (hasNonEmptyCompletion(parsed)) {
                okUpstream = { status: resUp.status, parsed, model: candidate };
                markProviderOk(route.via);
                break;
              }
              reasons.add("empty");
              console.error("[ai] upstream empty completion:", candidate, String(resUp.rawText).slice(0, 240));
            } catch (parseErr) {
              console.error("[ai] upstream invalid json:", candidate, parseErr);
            }
          } else {
            console.error("[ai] upstream error:", candidate, route.via, resUp.status, String(resUp.rawText).slice(0, 300));
          }
        } catch (err) {
          console.error("[ai] upstream fetch failed:", candidate, route.via, err?.message || err);
          markProviderFailure(route.via, 599);
          reasons.add(/timeout/.test(String(err?.message)) ? "timeout" : "network");
        }
      }
      if (okUpstream) break;
    }
    let safeBody;
    let outStatus;
    if (okUpstream) {
      outStatus = okUpstream.status;
      const parsed = okUpstream.parsed;
      const [usedIn, usedOut] = priceOf(okUpstream.model);
      try {
        const u = parsed?.usage || {};
        const tokens = Number(u.total_tokens) || (Number(u.prompt_tokens) || 0) + (Number(u.completion_tokens) || 0);
        const cost = Number(u.cost) > 0 ? Number(u.cost) : ((Number(u.prompt_tokens) || totalInChars / 3.5) * usedIn + (Number(u.completion_tokens) || complexity.reserveOutputTokens) * usedOut) / 1e6;
        await aiUsageAdd(uid, tokens, cost);
        if (!isAdmin) {
          const prevOver = Math.max(0, usage.userTokens - AI_LIMITS.dailyTokens);
          const nextOver = Math.max(0, usage.userTokens + tokens - AI_LIMITS.dailyTokens);
          const over = Math.max(0, nextOver - prevOver);
          if (over > 0) await aiTokensSpend(uid, over).catch((e) => console.error("[ai] tokens spend failed:", e));
        }
      } catch (e) {
        console.error("[ai] usage write failed:", e);
      }
      if (parsed && typeof parsed === "object") {
        parsed.model = "fracs-ai";
        if ("provider" in parsed) delete parsed.provider;
        if ("system_fingerprint" in parsed) delete parsed.system_fingerprint;
      }
      safeBody = JSON.stringify(parsed);
    } else {
      if (cxConsumed) {
        await refundBudgetWindow(cxKey, cxCost);
      }
      outStatus = lastStatus >= 500 ? lastStatus : 502;
      safeBody = JSON.stringify({ ok: false, error: "upstream", reasons: [...reasons], message: "Fracs AI \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435." });
    }
    res.setHeader("X-Fracs-Complexity-Tier", complexity.tier);
    res.setHeader("X-Fracs-Complexity-Cost", String(cxCost));
    if (!isAdmin && balance <= 0 && !isPhraseGen) {
      res.setHeader("X-Fracs-Complexity-Left", String(Math.max(0, cxLimit - cxUsed)));
    }
    if (!isAdmin && cxResetAt > 0) {
      res.setHeader("X-Fracs-Reset-At", String(cxResetAt));
    }
    res.status(outStatus).type("application/json").send(safeBody);
  } catch (e) {
    if (cxConsumed) await refundBudgetWindow(cxKey, cxCost);
    console.error("[ai] unexpected route error:", e);
    res.status(502).json({ ok: false, error: "upstream", message: "Fracs AI \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435." });
  }
}));
appRouter.get("/ai/models", h2(async (req, res) => {
  const rawKey = orAuthKey(req);
  const preUid = rawKey.length <= 256 ? parseKey(rawKey) : null;
  if (!preUid && !await rateLimit(`app-ai-bad:${req.ip}`, 60, 10 * 6e4, true)) {
    return void res.status(429).json({ ok: false, reason: "rate_limited" });
  }
  const gate2 = await fracsAiGate(req);
  if ("error" in gate2) return void res.status(gate2.error[0]).json(gate2.error[1]);
  if (!isAdminTg(gate2.user.tgId) && !await rateLimit(`app-ai-models:${req.ip}`, 120, 10 * 6e4, true)) {
    return void res.status(429).json({ ok: false, reason: "rate_limited" });
  }
  if (!hasAnyAiKey()) {
    return void res.status(503).json({ ok: false, error: "not_configured" });
  }
  res.json({
    data: [
      { id: "fracs-ai", name: "Fracs AI", context_length: 256e3 }
    ]
  });
}));
appRouter.get("/ai/usage", h2(async (req, res) => {
  const rawKey = orAuthKey(req);
  const preUid = rawKey.length <= 256 ? parseKey(rawKey) : null;
  if (!preUid && !await rateLimit(`app-ai-bad:${req.ip}`, 60, 10 * 6e4, true)) {
    return void res.status(429).json({ ok: false, reason: "rate_limited" });
  }
  const gate2 = await fracsAiGate(req);
  if ("error" in gate2) return void res.status(gate2.error[0]).json(gate2.error[1]);
  const isAdmin = isAdminTg(gate2.user.tgId);
  if (!isAdmin && !await rateLimit(`app-ai-usage:${req.ip}`, 120, 10 * 6e4, true)) {
    return void res.status(429).json({ ok: false, reason: "rate_limited" });
  }
  try {
    const uid = String(gate2.user.id);
    const emptyUsage = { userRequests: 0, userCostUsd: 0, userTokens: 0, totalRequests: 0, totalCostUsd: 0, totalTokens: 0 };
    const [usage, balance, cx, px] = await Promise.all([
      isAdmin ? aiUsageToday(uid).catch(() => emptyUsage) : aiUsageToday(uid),
      isAdmin ? aiTokensGet(uid).catch(() => 0) : aiTokensGet(uid),
      getBudgetWindow(`ai-cx-day:${uid}`).catch(() => ({ used: 0, resetAt: 0 })),
      getBudgetWindow(`ai-phrase-day:${uid}`).catch(() => ({ used: 0, resetAt: 0 }))
    ]);
    const allowed2 = AI_LIMITS.dailyTokens + balance;
    res.json({
      ok: true,
      now: Date.now(),
      unlimited: isAdmin,
      dailyIncluded: isAdmin ? null : AI_LIMITS.dailyTokens,
      usedToday: usage.userTokens,
      requestsToday: usage.userRequests,
      balance,
      tokensLeft: isAdmin ? null : Math.max(0, allowed2 - usage.userTokens),
      dailyComplexityLimit: isAdmin ? null : AI_LIMITS.dailyComplexity,
      complexityUsed: cx.used,
      complexityLeft: isAdmin ? null : Math.max(0, AI_LIMITS.dailyComplexity - cx.used),
      complexityResetAt: isAdmin ? null : cx.resetAt || null,
      dailyPhrasesLimit: isAdmin ? null : AI_LIMITS.dailyPhrases,
      phrasesUsed: px.used,
      phrasesLeft: isAdmin ? null : Math.max(0, AI_LIMITS.dailyPhrases - px.used),
      phrasesResetAt: isAdmin ? null : px.resetAt || null,
      packs: loadTokenPacks(),
      paymentMethods: {
        cryptobot: Boolean(config.cryptobotToken),
        xrocket: Boolean(config.xrocketKey),
        requisites: true
      },
      supportUsername: config.supportUsername
    });
  } catch (e) {
    console.error("[ai] usage endpoint failed:", e);
    res.status(503).json({ ok: false, error: "usage_unavailable" });
  }
}));
appRouter.post("/ai/buy", h2(async (req, res) => {
  if (!await rateLimit(`app-ai-buy-ip:${req.ip}`, 60, 10 * 6e4, true)) {
    return void res.status(429).json({ ok: false, error: "rate_limited", message: "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u0447\u0430\u0441\u0442\u043E. \u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435 \u043D\u0435\u043C\u043D\u043E\u0433\u043E." });
  }
  const gate2 = await fracsAiGate(req);
  if ("error" in gate2) return void res.status(gate2.error[0]).json(gate2.error[1]);
  const user = gate2.user;
  if (!await rateLimit(`app-ai-buy:${user.id}`, 15, 10 * 6e4, true)) {
    return void res.status(429).json({ ok: false, error: "rate_limited", message: "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u043C\u043D\u043E\u0433\u043E \u043F\u043E\u043F\u044B\u0442\u043E\u043A \u043E\u043F\u043B\u0430\u0442\u044B. \u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435 \u043F\u0430\u0440\u0443 \u043C\u0438\u043D\u0443\u0442." });
  }
  const packId = String(req.body?.packId || "");
  const pack = loadTokenPacks().find((p) => p.id === packId);
  if (!pack) {
    return void res.status(400).json({ ok: false, error: "bad_pack", message: "\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0439 \u043F\u0430\u043A\u0435\u0442 \u0442\u043E\u043A\u0435\u043D\u043E\u0432." });
  }
  const rawMethod = String(req.body?.method || "cryptobot");
  const supportUser = (config.supportUsername || "HelpManage").replace(/^@/, "");
  if (rawMethod === "requisites") {
    const whoLabel = user.tgId != null ? `${user.username ? "@" + user.username : user.firstName} (id ${user.tgId})` : `${user.email || user.firstName} (\u043F\u043E\u0447\u0442\u0430)`;
    const targetGrant = user.tgId != null ? String(user.tgId) : user.email || user.id;
    if (config.adminTgId > 0) {
      await notify(
        config.adminTgId,
        `\u{1F9FE} \u0417\u0430\u044F\u0432\u043A\u0430 \u043D\u0430 \u0442\u043E\u043A\u0435\u043D\u044B Fracs AI \u0438\u0437 \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u044B (\u0440\u0435\u043A\u0432\u0438\u0437\u0438\u0442\u044B)
${whoLabel}
\u041F\u0430\u043A\u0435\u0442: ${pack.title}, ${pack.priceRub} \u20BD

\u0412\u044B\u0434\u0430\u0442\u044C: /granttokens ${targetGrant} ${pack.tokens}`
      ).catch(() => {
      });
    }
    const text = `\u0417\u0434\u0440\u0430\u0432\u0441\u0442\u0432\u0443\u0439\u0442\u0435! \u0425\u043E\u0447\u0443 \u0434\u043E\u043A\u0443\u043F\u0438\u0442\u044C \u0442\u043E\u043A\u0435\u043D\u044B Fracs AI \u0438\u0437 \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u044B: ${pack.title} (${pack.priceRub} \u20BD).`;
    return void res.json({
      ok: true,
      method: "requisites",
      confirmationUrl: `https://t.me/${supportUser}?text=${encodeURIComponent(text)}`
    });
  }
  const method = rawMethod === "xrocket" ? "xrocket" : "cryptobot";
  try {
    const r = await createPayment(user, pack.id, method);
    res.json({ ok: true, method, paymentId: r.paymentId, confirmationUrl: r.confirmationUrl });
  } catch (e) {
    console.error("[app ai buy]", e);
    res.status(e.status || 502).json({
      ok: false,
      error: "payment",
      message: e.status ? e.message : "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0437\u0434\u0430\u0442\u044C \u0441\u0447\u0451\u0442 \u043D\u0430 \u043E\u043F\u043B\u0430\u0442\u0443. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \xAB\u0420\u0435\u043A\u0432\u0438\u0437\u0438\u0442\u044B\xBB."
    });
  }
}));
appRouter.get("/ai/design", h2(async (req, res) => {
  const rawKey = orAuthKey(req);
  const preUid = rawKey.length <= 256 ? parseKey(rawKey) : null;
  if (!preUid && !await rateLimit(`app-ai-bad:${req.ip}`, 60, 10 * 6e4, true)) {
    return void res.status(429).json({ ok: false, reason: "rate_limited" });
  }
  const gate2 = await fracsAiGate(req);
  if ("error" in gate2) return void res.status(gate2.error[0]).json(gate2.error[1]);
  if (!isAdminTg(gate2.user.tgId) && !await rateLimit(`app-ai-design:${req.ip}`, 60, 10 * 6e4, true)) {
    return void res.status(429).json({ ok: false, reason: "rate_limited" });
  }
  res.json({
    ok: true,
    version: DESIGN_VERSION,
    system: `DESIGN_SYSTEM_VERSION: ${DESIGN_VERSION}
` + FRACS_DESIGN_SYSTEM,
    libraries: DESIGN_LIBRARIES
  });
}));
var DEMO_MAX_BYTES = 12e5;
var DEMO_PER_DAY = envNum("DEMO_PER_DAY", 20);
var DEMO_MAX_ACTIVE = envNum("DEMO_MAX_ACTIVE", 300);
var DEMO_MARK = 'data-fracs-review="1"';
appRouter.post("/demo", h2(async (req, res) => {
  const rawKey = orAuthKey(req);
  const uid = rawKey.length <= 256 ? parseKey(rawKey) : null;
  if (!uid && !await rateLimit(`app-ai-bad:${req.ip}`, 60, 10 * 6e4, true)) {
    return void res.status(429).json({ ok: false, error: "rate_limited", message: "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u0447\u0430\u0441\u0442\u043E. \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u043F\u043E\u0437\u0436\u0435." });
  }
  const user = uid ? await getUser(uid) : null;
  if (!user) return void res.status(401).json({ ok: false, reason: "invalid" });
  const isAdmin = isAdminTg(user.tgId);
  if (!isAdmin && !await rateLimit(`app-demo:${req.ip}`, 60, 36e5, true)) {
    return void res.status(429).json({ ok: false, error: "rate_limited", message: "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u0447\u0430\u0441\u0442\u043E. \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u043F\u043E\u0437\u0436\u0435." });
  }
  if (!isSubscribed(user)) return void res.status(402).json({ ok: false, reason: "expired" });
  if (!await checkChannelSubs(user.tgId)) {
    return void res.status(403).json({ ok: false, error: "channels_required", message: "\u041F\u043E\u0434\u043F\u0438\u0448\u0438\u0442\u0435\u0441\u044C \u043D\u0430 \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u043A\u0430\u043D\u0430\u043B\u044B \u0432 \u0431\u043E\u0442\u0435 Fracs." });
  }
  const feats = await getActiveFeatures(user);
  if (!feats.some((f) => ["ai", "ai_provider", "fracs_ai"].includes(f))) {
    return void res.status(402).json({ ok: false, error: "plan", message: "\u041F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u044F \u0434\u0435\u043C\u043E \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430 \u0441 AI-\u0430\u0433\u0435\u043D\u0442\u043E\u043C (PRO / Ultra)." });
  }
  const html = req.body?.html;
  if (typeof html !== "string" || !html.includes(DEMO_MARK)) return void res.status(400).json({ ok: false, error: "bad_request", message: "\u041E\u0436\u0438\u0434\u0430\u0435\u0442\u0441\u044F \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430 \u0432\u0438\u0434\u0435\u043E\u043E\u0431\u0437\u043E\u0440\u0430." });
  if (Buffer.byteLength(html) > DEMO_MAX_BYTES) {
    return void res.status(413).json({ ok: false, error: "too_big", message: "\u0421\u0442\u0440\u0430\u043D\u0438\u0446\u0430 \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0431\u043E\u043B\u044C\u0448\u0430\u044F (\u043B\u0438\u043C\u0438\u0442 1,2 \u041C\u0411) \u2014 \u0443\u0431\u0435\u0440\u0438\u0442\u0435 \u0438\u0437 \u0441\u0430\u0439\u0442\u0430 \u0442\u044F\u0436\u0451\u043B\u044B\u0435 \u0432\u0441\u0442\u0440\u043E\u0435\u043D\u043D\u044B\u0435 \u043A\u0430\u0440\u0442\u0438\u043D\u043A\u0438." });
  }
  if (!isAdmin) {
    const c = await demoCounts(user.id);
    if (c.day >= DEMO_PER_DAY) return void res.status(429).json({ ok: false, error: "quota_day", message: `\u041B\u0438\u043C\u0438\u0442 \u043F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u0439 \u0434\u0435\u043C\u043E: ${DEMO_PER_DAY} \u0432 \u0441\u0443\u0442\u043A\u0438.` });
    if (c.total >= DEMO_MAX_ACTIVE) return void res.status(429).json({ ok: false, error: "quota_total", message: "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u043C\u043D\u043E\u0433\u043E \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0434\u0435\u043C\u043E \u2014 \u0441\u0442\u0430\u0440\u044B\u0435 \u0443\u0434\u0430\u043B\u044F\u044E\u0442\u0441\u044F \u0447\u0435\u0440\u0435\u0437 45 \u0434\u043D\u0435\u0439." });
  }
  const id = await demoCreate(user.id, html);
  res.json({ ok: true, id, url: `${config.appUrl}/v/${id}` });
}));
var demoPage = async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!/^[A-Za-z0-9_-]{8,24}$/.test(id)) return void res.status(404).type("text/plain").send("\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E");
    if (!await rateLimit(`demo-view:${req.ip}`, 120, 6e4, false)) return void res.status(429).type("text/plain").send("\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u0447\u0430\u0441\u0442\u043E");
    const rawHtml = await demoGet(id);
    if (!rawHtml) return void res.status(404).type("text/plain; charset=utf-8").send("\u0414\u0435\u043C\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E \u0438\u043B\u0438 \u0441\u0440\u043E\u043A \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F \u0438\u0441\u0442\u0451\u043A.");
    const html = rawHtml.replace(
      /(<script[^>]+id=["']site-data["'][^>]*>)([\s\S]*?)(<\/script>)/i,
      (_m, open, jsonBody, close) => `${open}${String(jsonBody).replace(/<\\!--/g, "\\u003c!--")}${close}`
    );
    res.set({
      "Content-Type": "text/html; charset=utf-8",
      // sandbox: страница живёт в «чужом» origin. allow-same-origin нужен самому review.html
      // (его JS читает <script type="application/json"> и грузит srcdoc iframe); сгенерированный
      // сайт при этом остаётся изолированным — у внутреннего iframe выставлен свой sandbox без allow-same-origin.
      "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-same-origin",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "public, max-age=300"
    }).send(html);
  } catch (e) {
    console.error("[demo]", e);
    res.status(500).type("text/plain").send("\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430");
  }
};

// server/adminRoutes.ts
import { Router as Router3 } from "express";

// server/webapp.ts
import crypto7 from "node:crypto";
function verifyInitData(initData) {
  if (!config.botToken || typeof initData !== "string" || !initData.trim()) {
    return { ok: false, error: "no_init_data" };
  }
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDate = Number(params.get("auth_date") || 0);
  if (!hash || hash.length !== 64 || !authDate) {
    return { ok: false, error: "bad_init_data" };
  }
  if (Date.now() / 1e3 - authDate > 3600) {
    return { ok: false, error: "expired" };
  }
  params.delete("hash");
  const dataCheckString = [...params.entries()].sort(([a2], [b2]) => a2 < b2 ? -1 : a2 > b2 ? 1 : 0).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto7.createHmac("sha256", "WebAppData").update(config.botToken).digest();
  const calc = crypto7.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const a = Buffer.from(calc);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !crypto7.timingSafeEqual(a, b)) {
    return { ok: false, error: "bad_hash" };
  }
  const userRaw = params.get("user");
  let user;
  try {
    user = userRaw ? JSON.parse(userRaw) : void 0;
  } catch {
  }
  return { ok: true, user };
}
function isAdminInitData(initData) {
  const v = verifyInitData(initData);
  return !!v.ok && !!v.user && v.user.id === config.adminTgId;
}

// server/adminRoutes.ts
var adminRouter = Router3();
var h3 = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
var requireAdmin = (req, res, next) => {
  const initData = req.get("x-tg-initdata") || (req.body && typeof req.body === "object" ? req.body.initData : "") || "";
  if (!config.adminTgId || !isAdminInitData(initData)) {
    return void res.status(403).json({ error: "forbidden", message: "\u0414\u043E\u0441\u0442\u0443\u043F \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430." });
  }
  next();
};
adminRouter.use(requireAdmin);
var publicUser = (u, tokenBalance = 0) => ({
  id: u.id,
  tgId: u.tgId,
  email: u.email,
  username: u.username,
  firstName: u.firstName,
  createdAt: u.createdAt,
  subscriptionUntil: u.subscriptionUntil,
  planId: u.planId,
  active: !!u.subscriptionUntil && Date.parse(u.subscriptionUntil) > Date.now(),
  tokenBalance
});
var publicPlan = (p) => ({ id: p.id, title: p.title, priceRub: p.priceRub, days: p.days, badge: p.badge ?? "", description: p.description ?? "", features: p.features ?? [] });
adminRouter.get("/me", h3(async (_req, res) => {
  res.json({ ok: true, admin: true, appUrl: config.appUrl });
}));
adminRouter.get("/users", h3(async (req, res) => {
  const limit2 = Math.min(Number(req.query.limit) || 100, 200);
  const users = await listRecentUsers(limit2);
  const balances = await Promise.all(users.map((u) => aiTokensGet(u.id).catch(() => 0)));
  res.json({ users: users.map((u, i) => publicUser(u, balances[i])) });
}));
async function locateUser(body) {
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return await getUser(id);
  const tgId = Number(body?.tgId);
  if (Number.isInteger(tgId) && tgId > 0) return await findUser(String(tgId));
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email) return await findUser(email);
  return null;
}
adminRouter.post("/grant", h3(async (req, res) => {
  const days = Math.round(Number(req.body?.days));
  const planId = req.body?.planId || void 0;
  if (!(days > 0 && days <= 3650)) return void res.status(400).json({ error: "bad_days", message: "\u0414\u043D\u0435\u0439: 1\u20133650." });
  const plans = await getPlans();
  if (planId && !plans.some((p) => p.id === planId)) {
    return void res.status(400).json({ error: "bad_plan", message: `\u0422\u0430\u0440\u0438\u0444 ${planId} \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D.` });
  }
  const user = await locateUser(req.body);
  if (!user) {
    return void res.status(404).json({ error: "user_not_found", message: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u2014 \u043F\u0443\u0441\u0442\u044C \u0441\u043D\u0430\u0447\u0430\u043B\u0430 \u0432\u043E\u0439\u0434\u0451\u0442 \u0432 \u043A\u0430\u0431\u0438\u043D\u0435\u0442 (Telegram \u0438\u043B\u0438 \u043A\u043E\u0434 \u0441 \u043F\u043E\u0447\u0442\u044B)." });
  }
  const updated = await extendSubscription(user.id, days, planId);
  const balance = await aiTokensGet(updated.id).catch(() => 0);
  try {
    await notify(updated.tgId, `\u2705 \u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 Fracs \u0430\u043A\u0442\u0438\u0432\u043D\u0430 \u0434\u043E ${new Date(updated.subscriptionUntil).toLocaleDateString("ru-RU")}. \u041A\u0430\u0431\u0438\u043D\u0435\u0442: ${config.appUrl}/app`);
  } catch {
  }
  res.json({ user: publicUser(updated, balance) });
}));
adminRouter.post("/revoke", h3(async (req, res) => {
  const user = await locateUser(req.body);
  if (!user) return void res.status(404).json({ error: "user_not_found" });
  const updated = await setSubscription(user.id, null);
  const balance = await aiTokensGet(updated.id).catch(() => 0);
  res.json({ user: publicUser(updated, balance) });
}));
adminRouter.get("/token-packs", h3(async (_req, res) => {
  res.json({ packs: loadTokenPacks() });
}));
adminRouter.post("/tokens/grant", h3(async (req, res) => {
  const packId = typeof req.body?.packId === "string" ? req.body.packId.trim() : "";
  const pack = packId ? loadTokenPacks().find((p) => p.id === packId) : void 0;
  const rawTokens = pack ? pack.tokens : Math.round(Number(req.body?.tokens));
  if (!Number.isFinite(rawTokens) || rawTokens < 1 || rawTokens > 5e7) {
    return void res.status(400).json({ error: "bad_tokens", message: "\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u043F\u0430\u043A\u0435\u0442 \u0438\u043B\u0438 \u0447\u0438\u0441\u043B\u043E \u0442\u043E\u043A\u0435\u043D\u043E\u0432 \u043E\u0442 1 \u0434\u043E 50 000 000." });
  }
  const user = await locateUser(req.body);
  if (!user) {
    return void res.status(404).json({ error: "user_not_found", message: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u2014 \u043F\u0443\u0441\u0442\u044C \u0441\u043D\u0430\u0447\u0430\u043B\u0430 \u0432\u043E\u0439\u0434\u0451\u0442 \u0432 \u043A\u0430\u0431\u0438\u043D\u0435\u0442 (Telegram \u0438\u043B\u0438 \u043A\u043E\u0434 \u0441 \u043F\u043E\u0447\u0442\u044B)." });
  }
  await aiTokensAdd(user.id, rawTokens);
  await Promise.all([
    refundBudgetWindow(`ai-cx-day:${user.id}`, 1e4),
    refundBudgetWindow(`ai-phrase-day:${user.id}`, 1e4)
  ]).catch(() => {
  });
  const balance = await aiTokensGet(user.id);
  try {
    await notify(
      user.tgId,
      `\u26A1\uFE0F \u041B\u0438\u043C\u0438\u0442\u044B Fracs AI \u043F\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u044B: +${rawTokens.toLocaleString("ru-RU")} \u0442\u043E\u043A\u0435\u043D\u043E\u0432 (\u0431\u0430\u043B\u0430\u043D\u0441: ${balance.toLocaleString("ru-RU")}). \u041F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 AI-\u0432\u043A\u043B\u0430\u0434\u043A\u0443 \u0438\u043B\u0438 \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0430\u0439\u0442\u0435 \u0440\u0430\u0431\u043E\u0442\u0443: ${config.appUrl}/app`
    );
  } catch {
  }
  res.json({ user: publicUser(user, balance), granted: rawTokens, tokenBalance: balance });
}));
adminRouter.get("/plans", h3(async (_req, res) => {
  const plans = await getPlans();
  res.json({ plans: plans.map(publicPlan) });
}));
adminRouter.post("/plan", h3(async (req, res) => {
  const id = String(req.body?.id || "");
  const b = req.body || {};
  const patch = {};
  if (typeof b.title === "string") patch.title = b.title.slice(0, 120);
  if (Number.isFinite(Number(b.priceRub))) patch.priceRub = Math.max(0, Math.round(Number(b.priceRub)));
  if (Number.isFinite(Number(b.days))) patch.days = Math.max(1, Math.round(Number(b.days)));
  if (typeof b.badge === "string") patch.badge = b.badge.slice(0, 60);
  if (typeof b.description === "string") patch.description = b.description.slice(0, 400);
  const updated = await updatePlan(id, patch);
  if (!updated) return void res.status(404).json({ error: "plan_not_found" });
  res.json({ plan: publicPlan(updated) });
}));
adminRouter.post("/plans/reset", h3(async (_req, res) => {
  const plans = await resetPlans();
  res.json({ plans: plans.map(publicPlan) });
}));
adminRouter.get("/training", h3(async (_req, res) => {
  res.json({ lessons: await getTraining() });
}));
adminRouter.post("/training/save", h3(async (req, res) => {
  const id = req.body?.id || void 0;
  const title = String(req.body?.title || "").trim();
  const body = String(req.body?.body || "");
  if (!title) return void res.status(400).json({ error: "bad_title", message: "\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A." });
  if (id) {
    const lesson = await updateLesson(id, { title, body });
    if (!lesson) return void res.status(404).json({ error: "lesson_not_found" });
    res.json({ lesson });
  } else {
    res.json({ lesson: await addLesson(title, body) });
  }
}));
adminRouter.post("/training/delete", h3(async (req, res) => {
  const id = String(req.body?.id || "");
  if (!id) return void res.status(400).json({ error: "bad_id" });
  const ok = await deleteLesson(id);
  res.json({ ok });
}));
adminRouter.get("/channels", h3(async (_req, res) => {
  res.json({ channels: await getRequiredChannels() });
}));
adminRouter.post("/channels", h3(async (req, res) => {
  const raw = req.body?.channels;
  if (!Array.isArray(raw)) return void res.status(400).json({ error: "bad_channels", message: "\u041E\u0436\u0438\u0434\u0430\u0435\u0442\u0441\u044F \u043C\u0430\u0441\u0441\u0438\u0432 \u0441\u0442\u0440\u043E\u043A." });
  const clean = await setRequiredChannels(raw.map((s) => String(s)));
  res.json({ channels: clean });
}));
adminRouter.post("/channels/check", h3(async (req, res) => {
  const id = String(req.body?.id || "").trim();
  if (!id) return void res.status(400).json({ error: "bad_id", message: "\u0423\u043A\u0430\u0436\u0438\u0442\u0435 @username \u0438\u043B\u0438 ID \u043A\u0430\u043D\u0430\u043B\u0430." });
  const info = await resolveChannel(id);
  res.json(info);
}));
var publicPromoCode = (p) => ({
  id: p.id,
  code: p.code,
  discountPercent: p.discountPercent,
  maxUses: p.maxUses,
  usedCount: p.usedCount,
  validUntil: p.validUntil,
  active: p.active,
  note: p.note,
  createdAt: p.createdAt
});
adminRouter.get("/promocodes", h3(async (_req, res) => {
  const list = await getPromocodes();
  res.json({ promocodes: list.map(publicPromoCode) });
}));
adminRouter.post("/promocodes/save", h3(async (req, res) => {
  const b = req.body || {};
  try {
    const promo = await savePromoCode({
      id: typeof b.id === "string" ? b.id : void 0,
      code: String(b.code || ""),
      discountPercent: Number(b.discountPercent),
      maxUses: Number(b.maxUses),
      validUntil: b.validUntil && String(b.validUntil).trim() ? String(b.validUntil) : null,
      active: Boolean(b.active),
      note: String(b.note || "")
    });
    res.json({ promo: publicPromoCode(promo) });
  } catch (e) {
    res.status(e?.status || 400).json({ error: "bad_promo", message: e?.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u043E\u043C\u043E\u043A\u043E\u0434\u0430" });
  }
}));
adminRouter.post("/promocodes/delete", h3(async (req, res) => {
  const id = String(req.body?.id || "");
  if (!id) return void res.status(400).json({ error: "bad_id" });
  const ok = await deletePromoCode(id);
  res.json({ ok });
}));
adminRouter.post("/promocodes/toggle", h3(async (req, res) => {
  const id = String(req.body?.id || "");
  if (!id) return void res.status(400).json({ error: "bad_id" });
  const promo = await togglePromoCode(id);
  if (!promo) return void res.status(404).json({ error: "promo_not_found" });
  res.json({ promo: publicPromoCode(promo) });
}));

// server/routes.ts
import crypto8 from "node:crypto";
import { Router as Router4 } from "express";

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
var api = Router4();
var h4 = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
var num = (v, min, max, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
var flag = (v) => v === true;
function trialOptions(body) {
  const f = body?.filters || {}, a = body?.advanced || {};
  return {
    filters: {
      dedup_franchises: flag(f.dedup_franchises),
      dedup_across_niches: f.dedup_across_niches !== false,
      require_phone: flag(f.require_phone),
      require_telegram: flag(f.require_telegram ?? f.require_whatsapp),
      require_social: flag(f.require_social),
      require_email: flag(f.require_email),
      require_website: false,
      require_no_website: true,
      min_rating: num(f.min_rating, 0, 5, 0),
      min_reviews: num(f.min_reviews, 0, 1e5, 0)
    },
    advanced: {
      disable_images: true,
      skip_404_response: a.skip_404_response !== false,
      delay_between_clicks: num(a.delay_between_clicks, 0, 5e3, 0),
      columns_per_entity: num(a.columns_per_entity, 1, 5, 3)
    }
  };
}
api.use("/auth", authRouter);
api.get("/health", h4(async (_req, res) => {
  res.json({ ok: true, db: await ping().catch(() => false) });
}));
api.get("/config", h4(async (_req, res) => {
  res.json({
    payment: config.paymentProvider,
    paymentMethods: {
      cryptobot: Boolean(config.cryptobotToken),
      xrocket: Boolean(config.xrocketKey),
      requisites: true
    },
    supportUsername: config.supportUsername,
    plans: await getPlans(),
    tokenPacks: loadTokenPacks(),
    demo: { maps: false, tg: false },
    adminUsername: config.adminUsername || void 0
  });
}));
api.get("/plans", h4(async (_req, res) => {
  res.json({ ok: true, plans: await getPlans(), tokenPacks: loadTokenPacks() });
}));
api.get("/cities", (req, res) => {
  res.json({ items: searchCities(String(req.query.q || "").slice(0, 40), 8) });
});
api.post("/payments/cryptobot/webhook", h4(async (req, res) => {
  try {
    await handleCryptoBotWebhook(req.body, req.rawBody, req.get("crypto-pay-api-signature") || "");
  } catch (e) {
    console.error("[cryptobot]", e);
    return void res.sendStatus(500);
  }
  res.sendStatus(200);
}));
api.post("/payments/xrocket/webhook", h4(async (req, res) => {
  try {
    await handleXRocketWebhook(req.body, req.rawBody, {
      legacySig: req.get("rocket-pay-signature") || "",
      signature: req.get("signature") || "",
      timestamp: req.get("signature-timestamp") || ""
    });
  } catch (e) {
    console.error("[xrocket]", e);
    return void res.sendStatus(500);
  }
  res.sendStatus(200);
}));
api.all("/cron/cleanup", h4(cronHandler));
var usedToday = (u) => countSearchesSince(u.id, 864e5);
api.get("/me", h4(async (req, res) => {
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
    features: await getActiveFeatures(u),
    channelsRequired: !await checkChannelSubs(u.tgId),
    trial: { maps: !mapsTrialUsed, tg: !tgTrialUsed },
    quota: { used: await usedToday(u), limit: config.dailySearchLimit }
  });
}));
api.get("/training", requireAuth, h4(async (req, res) => {
  const u = req.user;
  if (!isSubscribed(u)) return void res.status(402).json({ error: "subscription_required", message: "\u0420\u0430\u0437\u0434\u0435\u043B \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u043F\u043E \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0435." });
  const features = await getActiveFeatures(u);
  if (!features.includes("training")) {
    return void res.status(402).json({ error: "training_required", message: "\u0420\u0430\u0437\u0434\u0435\u043B \xAB\u041E\u0431\u0443\u0447\u0435\u043D\u0438\u0435\xBB \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u043D\u0430 \u0442\u0430\u0440\u0438\u0444\u0430\u0445 PRO \u0438 Ultra." });
  }
  res.json({ lessons: await getTraining() });
}));
var MASK = "\u2022\u2022\u2022";
var MAPS_DOMAINS = /* @__PURE__ */ new Set(["ru", "kz", "by", "az", "kg", "uz", "cz", "eg", "it", "sa", "com.cy", "ae", "cl", "qa", "om", "bh", "kw", "iq"]);
var maskPhone = (p) => p ? p.slice(0, 7) + "\u2022\u2022\u2022-\u2022\u2022-" + p.slice(-2) : null;
var maskStart = (s, keep = 3) => s.slice(0, keep) + MASK;
var parseCooldownMs = 6 * 60 * 6e4;
function signTrialTicket(ticket) {
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  const signature = crypto8.createHmac("sha256", config.sessionSecret).update("trial-ticket:" + payload).digest("base64url");
  return `${payload}.${signature}`;
}
function verifyTrialTicket(value, userId) {
  if (typeof value !== "string" || value.length > 4096) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = value.slice(0, separator);
  const supplied = Buffer.from(value.slice(separator + 1));
  const expected = Buffer.from(crypto8.createHmac("sha256", config.sessionSecret).update("trial-ticket:" + payload).digest("base64url"));
  if (supplied.length !== expected.length || !crypto8.timingSafeEqual(supplied, expected)) return null;
  try {
    const ticket = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (ticket.userId !== userId || !ticket.jobId || !ticket.seed || Date.now() - ticket.createdAt > 24 * 60 * 6e4) return null;
    return ticket;
  } catch {
    return null;
  }
}
function parse2gisUrl(value) {
  if (typeof value !== "string" || value.length > 2e3) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
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
api.post("/search/maps", requireAuth, h4(async (req, res) => {
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
api.post("/search/maps/trial/start", requireAuth, h4(async (req, res) => {
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
  const seed = crypto8.createHash("sha256").update([...uniqueUrls].sort().join("\n")).digest("hex");
  const labelsMap = req.body?.labels && typeof req.body.labels === "object" && !Array.isArray(req.body.labels) ? req.body.labels : null;
  try {
    const workerResponse = await fetch(`${config.mapsWorkerUrl}/api/internal/trial/jobs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.mapsWorkerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...trialOptions(req.body),
        urls: uniqueUrls,
        max_records: Math.min(60, Math.max(1, Number(req.body?.maxRecords) || 20)),
        clean: true,
        directions: uniqueUrls.map((url) => ({
          url,
          label: labelsMap && Object.hasOwn(labelsMap, url) ? String(labelsMap[url] || "") : ""
        }))
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
api.post("/search/maps/trial/status", requireAuth, h4(async (req, res) => {
  const ticket = verifyTrialTicket(req.body?.ticket, req.user.id);
  if (!ticket) return void res.status(400).json({ error: "bad_ticket", message: "\u0417\u0430\u0434\u0430\u043D\u0438\u0435 \u043D\u0435\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0442\u0435\u043B\u044C\u043D\u043E \u0438\u043B\u0438 \u0443\u0441\u0442\u0430\u0440\u0435\u043B\u043E. \u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0435 \u043F\u0440\u043E\u0431\u043D\u044B\u0439 \u043F\u043E\u0438\u0441\u043A \u0437\u0430\u043D\u043E\u0432\u043E." });
  const existing = (await recentSearches(req.user.id, "maps", 864e5)).find((record) => record.seed === ticket.seed && !record.demo && record.rowsTotal > 0);
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
      const rawUrl = typeof record.url === "string" ? record.url.trim() : "";
      return {
        id: String(record.id || `${ticket.jobId}-${index}`),
        name: cleanText(record.name, 200) || "\u0411\u0435\u0437 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044F",
        category: cleanText(Array.isArray(record.rubrics) ? record.rubrics.join(", ") : "", 160) || ticket.niche,
        address: cleanText([record.address, record.district, record.city].filter(Boolean).join(", "), 300),
        phone: typeof phoneValue === "string" && phoneValue ? cleanText(phoneValue, 80) : null,
        rating: ratingValue !== null && Number.isFinite(ratingValue) ? ratingValue : null,
        reviews: reviewsValue !== null && Number.isFinite(reviewsValue) ? reviewsValue : null,
        url: /^https?:\/\//i.test(rawUrl) ? rawUrl : null
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
      const used = (await recentSearches(req.user.id, "maps", 864e5)).find((record) => record.seed === ticket.seed && !record.demo && record.rowsTotal > 0);
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
api.post("/search/tg", requireAuth, h4(async (req, res) => {
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
api.get("/searches", requireAuth, h4(async (req, res) => {
  const kind = req.query.kind === "tg" ? "tg" : "maps";
  const items = (await listSearches(req.user.id, kind, 10)).map((s) => view(s, req.user));
  res.json({ items });
}));
var needSub2 = (res) => res.status(402).json({ error: "subscription_required", message: "\u0414\u0430\u043D\u043D\u044B\u0435 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B \u043F\u043E \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0435." });
var trialUsed = (res) => res.status(402).json({ error: "trial_used", message: "\u041F\u0440\u043E\u0431\u043D\u044B\u0439 \u043F\u043E\u0438\u0441\u043A \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D. \u041E\u0444\u043E\u0440\u043C\u0438\u0442\u0435 \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0443 \u0434\u043B\u044F \u043D\u043E\u0432\u043E\u0433\u043E \u043F\u043E\u0438\u0441\u043A\u0430." });
api.get("/search/:id", requireAuth, h4(async (req, res) => {
  const rec = await getSearch(String(req.params.id), req.user.id);
  if (!rec) return void res.status(404).json({ error: "not_found" });
  res.json(view(rec, req.user));
}));
api.get("/search/:id/rows", requireAuth, h4(async (req, res) => {
  if (!isSubscribed(req.user)) {
    const exists = await getSearch(String(req.params.id), req.user.id);
    return void (exists ? needSub2(res) : res.status(404).json({ error: "not_found" }));
  }
  const rec = await getSearch(String(req.params.id), req.user.id, true);
  if (!rec) return void res.status(404).json({ error: "not_found" });
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const limit2 = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  res.json({ rows: getRows(rec, offset, limit2), total: rec.rowsTotal });
}));
var csvCell = (v) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};
api.get("/search/:id/export.csv", requireAuth, h4(async (req, res) => {
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
api.post("/promo/validate", requireAuth, h4(async (req, res) => {
  if (!await rateLimit(`promo:${req.user.id}`, 20, 6e4)) return void res.status(429).json({ error: "rate_limited" });
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!code) return void res.json({ ok: false, discountPercent: 0 });
  const result = await validatePromoCode(code);
  res.json({ ok: Boolean(result), discountPercent: result?.discountPercent ?? 0, code: result?.code ?? null });
}));
api.post("/payments/request", requireAuth, h4(async (req, res) => {
  if (!await rateLimit(`payreq:${req.user.id}`, 5, 10 * 6e4)) return void res.status(429).json({ error: "rate_limited", message: "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u0447\u0430\u0441\u0442\u043E. \u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435 \u043D\u0435\u043C\u043D\u043E\u0433\u043E." });
  const pack = loadTokenPacks().find((t) => t.id === String(req.body?.planId || ""));
  const plans = pack ? [] : await getPlans();
  const plan = pack ? void 0 : plans.find((p) => p.id === String(req.body?.planId || ""));
  if (!pack && !plan) return void res.status(400).json({ error: "bad_plan", message: "\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0439 \u0442\u0430\u0440\u0438\u0444" });
  const u = req.user;
  const whoLabel = u.tgId != null ? `${u.username ? "@" + u.username : u.firstName} (id ${u.tgId})` : `${u.email || u.firstName} (\u043F\u043E\u0447\u0442\u0430)`;
  const targetGrant = u.tgId != null ? String(u.tgId) : u.email || u.id;
  if (config.adminTgId > 0) {
    await notify(
      config.adminTgId,
      pack ? `\u{1F9FE} \u0417\u0430\u044F\u0432\u043A\u0430 \u043D\u0430 \u0442\u043E\u043A\u0435\u043D\u044B Fracs AI (\u0440\u0435\u043A\u0432\u0438\u0437\u0438\u0442\u044B)
${whoLabel}
\u041F\u0430\u043A\u0435\u0442: ${pack.title}, ${pack.priceRub} \u20BD

\u0412\u044B\u0434\u0430\u0442\u044C: /granttokens ${targetGrant} ${pack.tokens}` : `\u{1F9FE} \u0417\u0430\u044F\u0432\u043A\u0430 \u043D\u0430 \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0443 (\u0440\u0435\u043A\u0432\u0438\u0437\u0438\u0442\u044B)
${whoLabel}
\u0422\u0430\u0440\u0438\u0444: ${plan.title}, ${plan.priceRub} \u20BD

\u0412\u044B\u0434\u0430\u0442\u044C: /grant ${targetGrant} ${plan.days} ${plan.id}`
    );
  }
  res.json({ ok: true });
}));
api.post("/payments/create", requireAuth, h4(async (req, res) => {
  if (!await rateLimit(`pay:${req.user.id}`, 10, 10 * 6e4)) return void res.status(429).json({ error: "rate_limited" });
  const rawMethod = req.body?.method;
  const method = rawMethod === "cryptobot" || rawMethod === "xrocket" ? rawMethod : void 0;
  try {
    const promoCode = typeof req.body?.promoCode === "string" ? req.body.promoCode.trim() : "";
    res.json(await createPayment(req.user, String(req.body?.planId || ""), method, promoCode || void 0));
  } catch (e) {
    console.error("[pay]", e);
    res.status(e.status || 502).json({ error: "payment", message: e.status ? e.message : "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0437\u0434\u0430\u0442\u044C \u043F\u043B\u0430\u0442\u0451\u0436. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435." });
  }
}));

// server/security.ts
var CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://telegram.org",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://images.unsplash.com",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests"
].join("; ");
function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  if (config.isProd) {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    res.setHeader("Content-Security-Policy", CSP);
  }
  next();
}
var noStoreApi = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
};
var SAFE = /* @__PURE__ */ new Set(["GET", "HEAD", "OPTIONS"]);
var allowed = new Set(
  [config.appUrl, ...(process.env.EXTRA_ORIGINS || "").split(",")].map((s) => s.trim()).filter(Boolean).map((u) => {
    try {
      return new URL(u).origin;
    } catch {
      return "";
    }
  })
);
function csrfGuard(req, res, next) {
  if (SAFE.has(req.method)) return next();
  const origin = req.get("origin");
  const sameHost = origin === `${req.protocol}://${req.get("host")}`;
  if (origin ? !(sameHost || allowed.has(origin)) : req.get("sec-fetch-site") === "cross-site") {
    return void res.status(403).json({ error: "forbidden_origin" });
  }
  next();
}
var hits = /* @__PURE__ */ new Map();
var limit = (name, max, windowMs) => (req, res, next) => {
  const now = Date.now();
  if (hits.size > 2e4) {
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }
  const key = `${name}:${req.ip}`;
  const e = hits.get(key);
  if (!e || e.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return next();
  }
  if (++e.n > max) return void res.status(429).json({ error: "rate_limited" });
  next();
};

// server/app.ts
function buildApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use((req, _res, next) => {
    try {
      const b = req.body;
      if (b !== void 0 && b !== null && typeof b === "object" && !Buffer.isBuffer(b)) req._body = true;
      next();
    } catch (e) {
      next(Object.assign(e, { type: "entity.parse.failed" }));
    }
  });
  app.use("/api/app/demo", express.json({ limit: "1500kb" }));
  app.use("/api/app/ai", express.json({ limit: "8mb" }));
  app.use(express.json({
    limit: "100kb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    }
  }));
  app.post("/api/bot/webhook", webhookHandler);
  app.get("/v/:id", demoPage);
  app.use("/api", noStoreApi, csrfGuard);
  app.use("/api/cities", limit("cities", 60, 6e4));
  app.use("/api/config", limit("config", 60, 6e4));
  app.use("/api/admin", adminRouter);
  app.use("/api/app", attachUser, appRouter);
  app.use("/api", attachUser, api);
  app.use("/api", (_req, res) => res.status(404).json({ error: "not_found" }));
  app.use((err, _req, res, _next) => {
    if (err?.type === "entity.parse.failed") return void res.status(400).json({ error: "bad_json" });
    console.error(err);
    res.status(500).json({ error: "server_error" });
  });
  void ensureWebhook();
  return app;
}

// server/vercel.ts
var vercel_default = buildApp();
export {
  vercel_default as default
};
