// server/app.ts
import express from "express";

// server/auth.ts
import crypto3 from "node:crypto";
import { Router } from "express";

// server/config.ts
import "dotenv/config";
var env = process.env;
var isProd = env.NODE_ENV === "production";
var port = Number(env.PORT || 3e3);
var vercelUrl = env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "";
var config = {
  isProd,
  port,
  appUrl: (env.APP_URL || vercelUrl || `http://localhost:${port}`).replace(/\/$/, ""),
  sessionSecret: env.SESSION_SECRET || (isProd ? "" : "dev-secret-change-me"),
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
  tgProvider: env.TG_PROVIDER || "mock",
  tgParserUrl: (env.TG_PARSER_URL || "").replace(/\/$/, ""),
  tgParserKey: env.TG_PARSER_KEY || "",
  paymentProvider: env.PAYMENT_PROVIDER || "mock",
  allowMockPayments: !isProd || env.ALLOW_MOCK_PAYMENTS === "true",
  yookassaShopId: env.YOOKASSA_SHOP_ID || "",
  yookassaSecret: env.YOOKASSA_SECRET_KEY || "",
  dailySearchLimit: Number(env.DAILY_SEARCH_LIMIT || 40)
};
if (isProd && !config.sessionSecret) {
  throw new Error("SESSION_SECRET \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u0435\u043D \u0432 production (\u043B\u044E\u0431\u0430\u044F \u0434\u043B\u0438\u043D\u043D\u0430\u044F \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u0430\u044F \u0441\u0442\u0440\u043E\u043A\u0430).");
}
var PLANS = [
  { id: "month", title: "1 \u043C\u0435\u0441\u044F\u0446", days: 30, priceRub: 4900 },
  { id: "quarter", title: "3 \u043C\u0435\u0441\u044F\u0446\u0430", days: 90, priceRub: 12900, badge: "\u0412\u044B\u0433\u043E\u0434\u043D\u0435\u0435 \u043D\u0430 12%" }
];

// server/db.ts
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
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
function check(r, what) {
  if (r.error) throw new Error(`[db] ${what}: ${r.error.message}`);
  return r.data;
}
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var ago = (ms) => new Date(Date.now() - ms).toISOString();
var newId = () => crypto.randomUUID();
var userOf = (r) => ({
  id: r.id,
  tgId: Number(r.tg_id),
  username: r.username,
  firstName: r.first_name,
  createdAt: r.created_at,
  subscriptionUntil: r.subscription_until
});
async function getUser(id) {
  if (!UUID.test(id)) return null;
  const r = await sb().from("users").select("*").eq("id", id).maybeSingle();
  const row = check(r, "getUser");
  return row ? userOf(row) : null;
}
async function upsertTgUser(from) {
  const existing = check(await sb().from("users").select("first_name").eq("tg_id", from.id).maybeSingle(), "upsertTgUser.find");
  const r = await sb().from("users").upsert(
    { tg_id: from.id, username: from.username ?? null, first_name: from.first_name || existing?.first_name || "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C" },
    { onConflict: "tg_id" }
  ).select("*").single();
  return userOf(check(r, "upsertTgUser"));
}
var isSubscribed = (u) => !!u.subscriptionUntil && Date.parse(u.subscriptionUntil) > Date.now();
async function extendSubscription(userId, days) {
  const u = await getUser(userId);
  if (!u) throw new Error("user not found");
  const base = isSubscribed(u) ? Date.parse(u.subscriptionUntil) : Date.now();
  const until = new Date(base + days * 864e5).toISOString();
  const r = await sb().from("users").update({ subscription_until: until }).eq("id", userId).select("*").single();
  return userOf(check(r, "extendSubscription"));
}
var TOKEN_MS = 10 * 6e4;
async function createLoginToken(token) {
  await sb().from("login_tokens").delete().lt("created_at", ago(TOKEN_MS));
  check(await sb().from("login_tokens").insert({ token }), "createLoginToken");
}
async function getLoginToken(token) {
  const row = check(await sb().from("login_tokens").select("*").eq("token", token).maybeSingle(), "getLoginToken");
  if (!row || Date.now() - Date.parse(row.created_at) > TOKEN_MS) return null;
  return { token: row.token, createdAt: Date.parse(row.created_at), userId: row.user_id ?? void 0 };
}
async function bindLoginToken(token, userId) {
  const r = await sb().from("login_tokens").update({ user_id: userId }).eq("token", token).is("user_id", null).gt("created_at", ago(TOKEN_MS)).select("token");
  return check(r, "bindLoginToken").length > 0;
}
async function takeLoginToken(token) {
  const r = await sb().from("login_tokens").delete().eq("token", token).not("user_id", "is", null).select("user_id");
  const rows = check(r, "takeLoginToken");
  return rows[0]?.user_id ?? null;
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
}
async function countSearchesSince(userId, sinceMs) {
  const r = await sb().from("searches").select("id", { count: "exact", head: true }).eq("user_id", userId).gt("created_at", ago(sinceMs));
  if (r.error) throw new Error(`[db] countSearchesSince: ${r.error.message}`);
  return r.count ?? 0;
}
async function recentSearches(userId, kind, sinceMs) {
  const r = await sb().from("searches").select(SEARCH_COLS).eq("user_id", userId).eq("kind", kind).gt("created_at", ago(sinceMs)).order("created_at", { ascending: false }).limit(100);
  return check(r, "recentSearches").map(searchOf);
}
async function listSearches(userId, kind, limit) {
  const r = await sb().from("searches").select(SEARCH_COLS).eq("user_id", userId).eq("kind", kind).order("created_at", { ascending: false }).limit(limit);
  return check(r, "listSearches").map(searchOf);
}
async function getSearch(id, userId, withRows = false) {
  if (!UUID.test(id)) return null;
  const cols = withRows ? SEARCH_COLS + ",rows" : SEARCH_COLS;
  const r = await sb().from("searches").select(cols).eq("id", id).eq("user_id", userId).maybeSingle();
  const row = check(r, "getSearch");
  return row ? searchOf(row) : null;
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
}
async function setPaymentProviderId(id, providerId) {
  check(await sb().from("payments").update({ provider_id: providerId }).eq("id", id), "setPaymentProviderId");
}
async function findPaymentByProviderId(providerId) {
  const row = check(await sb().from("payments").select("*").eq("provider_id", providerId).maybeSingle(), "findPayment");
  return row ? payOf(row) : null;
}
async function cancelPayment(id) {
  check(await sb().from("payments").update({ status: "canceled" }).eq("id", id).eq("status", "pending"), "cancelPayment");
}
async function claimPayment(id) {
  const r = await sb().from("payments").update({ status: "succeeded", paid_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", id).eq("status", "pending").select("*");
  const rows = check(r, "claimPayment");
  return rows[0] ? payOf(rows[0]) : null;
}
async function revertPayment(id) {
  await sb().from("payments").update({ status: "pending", paid_at: null }).eq("id", id);
}
async function rateLimit(key, max, windowMs) {
  const r = await sb().rpc("rate_limit", { p_key: key, p_max: max, p_window_ms: windowMs });
  if (r.error) {
    console.error("[db] rateLimit:", r.error.message);
    return true;
  }
  return r.data === true;
}
async function cleanup(retentionDays) {
  const c = sb();
  await c.from("login_tokens").delete().lt("created_at", ago(TOKEN_MS));
  await c.from("rate_limits").delete().lt("reset_at", (/* @__PURE__ */ new Date()).toISOString());
  await c.from("searches").delete().lt("created_at", ago(retentionDays * 864e5));
}
async function usersToRemind() {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const soon = new Date(Date.now() + 3 * 864e5).toISOString();
  const r = await sb().from("users").select("*").gt("subscription_until", now).lt("subscription_until", soon);
  return check(r, "usersToRemind").filter((x) => x.expiry_notified_for !== x.subscription_until).map((x) => ({ ...userOf(x), notifiedFor: x.expiry_notified_for }));
}
async function markReminded(userId, until) {
  await sb().from("users").update({ expiry_notified_for: until }).eq("id", userId);
}
async function ping() {
  const r = await sb().from("users").select("id", { head: true, count: "exact" }).limit(1);
  return !r.error;
}

// server/util.ts
import crypto2 from "node:crypto";
function norm(s) {
  return s.toLowerCase().replace(/ё/g, "\u0435").replace(/[-–—_.,]/g, " ").replace(/\s+/g, " ").trim();
}
function hashStr(s) {
  let h3 = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h3 ^= s.charCodeAt(i);
    h3 = Math.imul(h3, 16777619);
  }
  return h3 >>> 0;
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
var randomToken = (bytes = 24) => crypto2.randomBytes(bytes).toString("base64url");
function cleanText(v, max) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto2.timingSafeEqual(ab, bb);
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
async function notify(tgId, text) {
  if (!config.botToken) return;
  try {
    await tg("sendMessage", { chat_id: tgId, text });
  } catch (e) {
    console.error("[bot] sendMessage", e);
  }
}
async function handleUpdate(update) {
  const msg = update?.message;
  if (!msg?.text || !msg.from || msg.chat?.type !== "private") return;
  const [cmd, param] = msg.text.trim().split(/\s+/);
  if (cmd !== "/start") {
    await notify(msg.chat.id, `\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043B\u0438\u0447\u043D\u044B\u0439 \u043A\u0430\u0431\u0438\u043D\u0435\u0442: ${config.appUrl}/app`);
    return;
  }
  if (!param) {
    await notify(msg.chat.id, `\u041F\u0440\u0438\u0432\u0435\u0442! \u042D\u0442\u043E \u0431\u043E\u0442 Fracs. \u0427\u0442\u043E\u0431\u044B \u0432\u043E\u0439\u0442\u0438, \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u0412\u043E\u0439\u0442\u0438 \u0447\u0435\u0440\u0435\u0437 Telegram\xBB \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435 ${config.appUrl}/app`);
    return;
  }
  const user = await upsertTgUser(msg.from);
  const ok = await bindLoginToken(param, user.id);
  if (!ok) {
    await notify(msg.chat.id, "\u0421\u0441\u044B\u043B\u043A\u0430 \u0443\u0441\u0442\u0430\u0440\u0435\u043B\u0430. \u0412\u0435\u0440\u043D\u0438\u0442\u0435\u0441\u044C \u043D\u0430 \u0441\u0430\u0439\u0442 \u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u0412\u043E\u0439\u0442\u0438 \u0447\u0435\u0440\u0435\u0437 Telegram\xBB \u0435\u0449\u0451 \u0440\u0430\u0437.");
    return;
  }
  await notify(msg.chat.id, `\u2705 \u0413\u043E\u0442\u043E\u0432\u043E, ${user.firstName}! \u0412\u0435\u0440\u043D\u0438\u0442\u0435\u0441\u044C \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440 \u2014 \u0432\u0445\u043E\u0434 \u0432\u044B\u043F\u043E\u043B\u043D\u0438\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438.`);
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
var sign = (p) => crypto3.createHmac("sha256", config.sessionSecret).update(p).digest("base64url");
function makeSession(uid) {
  const payload = Buffer.from(JSON.stringify({ u: uid, e: Date.now() + SESSION_MS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
function readSession(raw) {
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto3.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
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
function setSession(req, res, uid) {
  const secure = req.secure || config.isProd;
  res.append("Set-Cookie", `${COOKIE}=${makeSession(uid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1e3}${secure ? "; Secure" : ""}`);
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
  const user = await upsertTgUser({ id: 1, username: "dev_user", first_name: "\u0420\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u0447\u0438\u043A" });
  setSession(req, res, user.id);
  res.json({ ok: true });
}));
authRouter.post("/logout", (_req, res) => {
  res.append("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

// server/routes.ts
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
var DEMO_ROWS_CAP = 300;
var mapsIsDemo = () => config.mapsProvider !== "2gis";
async function searchMaps(niche, city) {
  if (config.mapsProvider === "2gis") return gisSearch(niche, city);
  return { stats: mockMapsStats(`${norm(niche)}|${city.id}`, city) };
}
function mockMapsStats(seed, city) {
  const r = mulberry32(hashStr(seed));
  const [lo, hi] = { big: [900, 2600], mid: [300, 950], small: [40, 320] }[cityTier(city)];
  const total = rint(r, lo, hi);
  const withoutSite = Math.round(total * (0.28 + r() * 0.24));
  const withPhone = Math.round(withoutSite * (0.7 + r() * 0.22));
  return { total, withoutSite, withPhone };
}
var PREFIX = ["\u041F\u0440\u043E\u0444\u0438", "\u041C\u0430\u0441\u0442\u0435\u0440", "\u0426\u0435\u043D\u0442\u0440", "\u042D\u043A\u0441\u043F\u0435\u0440\u0442", "\u0410\u043B\u044C\u0444\u0430", "\u0413\u0430\u0440\u0430\u043D\u0442", "\u041B\u0438\u0434\u0435\u0440", "\u0412\u0435\u043A\u0442\u043E\u0440", "\u0421\u043E\u044E\u0437", "\u041D\u043E\u0440\u043C\u0430"];
var STREETS = ["\u041B\u0435\u043D\u0438\u043D\u0430", "\u041C\u0438\u0440\u0430", "\u0421\u043E\u0432\u0435\u0442\u0441\u043A\u0430\u044F", "\u0413\u0430\u0433\u0430\u0440\u0438\u043D\u0430", "\u041F\u0440\u043E\u043C\u044B\u0448\u043B\u0435\u043D\u043D\u0430\u044F", "\u0426\u0435\u043D\u0442\u0440\u0430\u043B\u044C\u043D\u0430\u044F", "\u0428\u043A\u043E\u043B\u044C\u043D\u0430\u044F", "\u0417\u0430\u0432\u043E\u0434\u0441\u043A\u0430\u044F", "\u041A\u0438\u0440\u043E\u0432\u0430", "\u041F\u043E\u0431\u0435\u0434\u044B"];
function mockMapsRow(rec, i) {
  const r = mulberry32(hashStr(`${rec.seed}:${i}`));
  const niche = rec.query.niche || "\u041A\u043E\u043C\u043F\u0430\u043D\u0438\u044F";
  const phoneShare = rec.stats.withPhone / Math.max(1, rec.stats.withoutSite);
  return {
    id: `demo-${i}`,
    name: `${niche[0].toUpperCase()}${niche.slice(1)} \xAB${pick(r, PREFIX)}-${rint(r, 1, 99)}\xBB`,
    category: niche,
    address: `${rec.query.cityLabel?.split(",")[0] ?? ""}, \u0443\u043B. ${pick(r, STREETS)}, ${rint(r, 1, 120)}`,
    phone: r() < phoneShare ? `+7 (900) 000-${String(rint(r, 0, 99)).padStart(2, "0")}-${String(rint(r, 0, 99)).padStart(2, "0")}` : null,
    rating: Math.round((3.8 + r() * 1.2) * 10) / 10,
    reviews: rint(r, 3, 250),
    url: null
  };
}
async function gisSearch(niche, city) {
  if (!config.gisKey) throw new Error("GIS_API_KEY \u043D\u0435 \u0437\u0430\u0434\u0430\u043D");
  const MAX_PAGES = 10;
  const PAGE = 50;
  const rows = [];
  let scanned = 0;
  let total = 0;
  const fetchPage = async (page) => {
    const url = new URL("https://catalog.api.2gis.com/3.0/items");
    url.searchParams.set("q", `${niche} ${city.name}`);
    url.searchParams.set("type", "branch");
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", String(PAGE));
    url.searchParams.set("fields", "items.contact_groups,items.reviews,items.address_name,items.rubrics");
    url.searchParams.set("key", config.gisKey);
    const resp = await fetch(url, { signal: AbortSignal.timeout(15e3) });
    if (!resp.ok) {
      if (page === 1) throw new Error(`2\u0413\u0418\u0421 \u043E\u0442\u0432\u0435\u0442\u0438\u043B ${resp.status}`);
      return null;
    }
    const json = await resp.json();
    if (page === 1) total = Number(json?.result?.total ?? 0);
    return json?.result?.items ?? [];
  };
  const take = (items) => {
    scanned += items.length;
    for (const it of items) {
      const contacts = (it.contact_groups ?? []).flatMap((g) => g.contacts ?? []);
      if (contacts.some((c) => c.type === "website")) continue;
      const phone = contacts.find((c) => c.type === "phone");
      rows.push({
        id: String(it.id),
        name: String(it.name ?? ""),
        category: String(it.rubrics?.[0]?.name ?? niche),
        address: String(it.address_name ?? city.name),
        phone: phone ? String(phone.text ?? phone.value ?? "") || null : null,
        rating: it.reviews?.general_rating ?? null,
        reviews: it.reviews?.general_review_count ?? null,
        url: `https://2gis.ru/firm/${String(it.id).split("_")[0]}`
      });
    }
  };
  const first = await fetchPage(1) ?? [];
  take(first);
  if (first.length >= PAGE) {
    const last = Math.min(MAX_PAGES, Math.max(2, Math.ceil(total / PAGE)));
    for (let from = 2; from <= last; from += 5) {
      const batch = await Promise.all(Array.from({ length: Math.min(5, last - from + 1) }, (_, i) => fetchPage(from + i).catch(() => null)));
      for (const items of batch) if (items?.length) take(items);
      if (batch.some((b) => !b || b.length < PAGE)) break;
    }
  }
  return {
    stats: { total: Math.max(total, scanned), withoutSite: rows.length, withPhone: rows.filter((r) => r.phone).length },
    rows
  };
}
var tgIsDemo = () => config.tgProvider !== "http";
async function searchTg(phrase, days) {
  if (config.tgProvider === "http") return tgHttpSearch(phrase, days);
  const r = mulberry32(hashStr(`${norm(phrase)}|${days}`));
  return { stats: { people: rint(r, 8, 140) * days, chats: rint(r, 4, 40) } };
}
var NAMES = ["\u0410\u043B\u0435\u043A\u0441\u0435\u0439", "\u041C\u0430\u0440\u0438\u044F", "\u0414\u043C\u0438\u0442\u0440\u0438\u0439", "\u0410\u043D\u043D\u0430", "\u0421\u0435\u0440\u0433\u0435\u0439", "\u041E\u043B\u044C\u0433\u0430", "\u0418\u0432\u0430\u043D", "\u0415\u043B\u0435\u043D\u0430", "\u0410\u043D\u0434\u0440\u0435\u0439", "\u041D\u0430\u0442\u0430\u043B\u044C\u044F"];
function mockTgRow(rec, i) {
  const r = mulberry32(hashStr(`${rec.seed}:${i}`));
  const username = `demo_user_${rint(r, 1e3, 9999)}`;
  const days = rec.query.days ?? 3;
  return {
    id: `demo-${i}`,
    username,
    name: pick(r, NAMES),
    chat: `\u0414\u0435\u043C\u043E-\u0447\u0430\u0442 ${rint(r, 1, rec.stats.chats)}`,
    text: `\u0418\u0449\u0443: ${rec.query.phrase}. \u041A\u0442\u043E \u043C\u043E\u0436\u0435\u0442 \u043F\u043E\u043C\u043E\u0447\u044C? \u041F\u0438\u0448\u0438\u0442\u0435 \u0432 \u043B\u0438\u0447\u043D\u044B\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F.`,
    date: new Date(Date.now() - r() * days * 864e5).toISOString(),
    link: `https://t.me/${username}`
  };
}
async function tgHttpSearch(phrase, days) {
  if (!config.tgParserUrl) throw new Error("TG_PARSER_URL \u043D\u0435 \u0437\u0430\u0434\u0430\u043D");
  const resp = await fetch(`${config.tgParserUrl}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.tgParserKey}` },
    body: JSON.stringify({ phrase, days }),
    signal: AbortSignal.timeout(25e3)
  });
  if (!resp.ok) throw new Error(`TG-\u043F\u0430\u0440\u0441\u0435\u0440 \u043E\u0442\u0432\u0435\u0442\u0438\u043B ${resp.status}`);
  const rows = (await resp.json()).rows ?? [];
  return {
    stats: { people: new Set(rows.map((x) => x.username || x.id)).size, chats: new Set(rows.map((x) => x.chat)).size },
    rows
  };
}
function summarize(kind, stats, rows) {
  const rowsTotal = rows ? rows.length : Math.min(kind === "maps" ? stats.withoutSite : stats.people, DEMO_ROWS_CAP);
  return { rowsTotal, head: rows ? rows.slice(0, 3) : void 0 };
}
function getRows(rec, offset, limit) {
  if (!rec.demo) return (rec.rows ?? []).slice(offset, offset + limit);
  const end = Math.min(offset + limit, rec.rowsTotal);
  const out = [];
  for (let i = offset; i < end; i++) out.push(rec.kind === "maps" ? mockMapsRow(rec, i) : mockTgRow(rec, i));
  return out;
}
var headRows = (rec) => rec.demo ? getRows(rec, 0, 3) : rec.head ?? [];

// server/payments.ts
var YK = "https://api.yookassa.ru/v3/payments";
var ykAuth = () => "Basic " + Buffer.from(`${config.yookassaShopId}:${config.yookassaSecret}`).toString("base64");
async function activate(p) {
  const [user, plan] = [await getUser(p.userId), PLANS.find((x) => x.id === p.planId)];
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
  const plan = PLANS.find((p) => p.id === planId);
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
var api = Router2();
var h2 = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
api.use("/auth", authRouter);
api.get("/health", h2(async (_req, res) => {
  res.json({ ok: true, db: await ping().catch(() => false) });
}));
api.get("/config", (_req, res) => {
  res.json({
    devLogin: config.devLogin,
    payment: config.paymentProvider,
    plans: PLANS,
    demo: { maps: mapsIsDemo(), tg: tgIsDemo() }
  });
});
api.get("/cities", (req, res) => {
  res.json({ items: searchCities(String(req.query.q || ""), 8) });
});
api.post("/payments/yookassa/webhook", h2(async (req, res) => {
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
api.all("/cron/cleanup", h2(cronHandler));
var usedToday = (u) => countSearchesSince(u.id, 864e5);
api.get("/me", h2(async (req, res) => {
  const u = req.user;
  if (!u) return void res.json({ user: null });
  res.json({
    user: { id: u.id, firstName: u.firstName, username: u.username },
    subscription: { active: isSubscribed(u), until: u.subscriptionUntil },
    quota: { used: await usedToday(u), limit: config.dailySearchLimit }
  });
}));
var MASK = "\u2022\u2022\u2022";
var maskPhone = (p) => p ? p.slice(0, 7) + "\u2022\u2022\u2022-\u2022\u2022-" + p.slice(-2) : null;
var maskStart = (s, keep = 3) => s.slice(0, keep) + MASK;
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
  return (await recentSearches(u.id, kind, 864e5)).find(match);
}
api.post("/search/maps", requireAuth, h2(async (req, res) => {
  const niche = cleanText(req.body?.niche, 80);
  const city = findCity(String(req.body?.cityId || ""));
  if (niche.length < 2) return void res.status(400).json({ error: "bad_niche", message: "\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u043D\u0438\u0448\u0443 \u2014 \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440, \xAB\u0430\u0432\u0442\u043E\u0441\u0435\u0440\u0432\u0438\u0441\xBB." });
  if (!city) return void res.status(400).json({ error: "bad_city", message: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0433\u043E\u0440\u043E\u0434 \u0438\u0437 \u0441\u043F\u0438\u0441\u043A\u0430." });
  const again = await findRecent(req.user, "maps", (s) => s.query.cityId === city.id && norm(s.query.niche || "") === norm(niche));
  if (again) return void res.json(view(again, req.user));
  if (!await gate(req, res)) return;
  try {
    const result = await searchMaps(niche, city);
    const stats = { ...result.stats };
    const rec = {
      id: newId(),
      userId: req.user.id,
      kind: "maps",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      demo: mapsIsDemo(),
      seed: `${norm(niche)}|${city.id}`,
      query: { niche, cityId: city.id, cityLabel: `${city.name}, ${city.region}` },
      stats,
      rows: result.rows,
      ...summarize("maps", stats, result.rows)
    };
    await insertSearch(rec);
    res.json(view(rec, req.user));
  } catch (e) {
    console.error("[maps]", e);
    res.status(502).json({ error: "provider", message: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435." });
  }
}));
api.post("/search/tg", requireAuth, h2(async (req, res) => {
  const phrase = cleanText(req.body?.phrase, 120);
  const days = Math.min(3, Math.max(1, Math.round(Number(req.body?.days) || 3)));
  if (phrase.length < 3) return void res.status(400).json({ error: "bad_phrase", message: "\u041E\u043F\u0438\u0448\u0438\u0442\u0435, \u043A\u043E\u043C\u0443 \u0438 \u0447\u0442\u043E \u043D\u0443\u0436\u043D\u043E \u2014 \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440, \xAB\u043D\u0443\u0436\u0435\u043D \u0441\u0430\u0439\u0442\xBB." });
  const again = await findRecent(req.user, "tg", (s) => norm(s.query.phrase || "") === norm(phrase) && s.query.days === days);
  if (again) return void res.json(view(again, req.user));
  if (!await gate(req, res)) return;
  try {
    const result = await searchTg(phrase, days);
    const stats = { ...result.stats };
    const rec = {
      id: newId(),
      userId: req.user.id,
      kind: "tg",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      demo: tgIsDemo(),
      seed: `${norm(phrase)}|${days}`,
      query: { phrase, days },
      stats,
      rows: result.rows,
      ...summarize("tg", stats, result.rows)
    };
    await insertSearch(rec);
    res.json(view(rec, req.user));
  } catch (e) {
    console.error("[tg]", e);
    res.status(502).json({ error: "provider", message: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435." });
  }
}));
api.get("/searches", requireAuth, h2(async (req, res) => {
  const kind = req.query.kind === "tg" ? "tg" : "maps";
  const items = (await listSearches(req.user.id, kind, 10)).map((s) => view(s, req.user));
  res.json({ items });
}));
var needSub = (res) => res.status(402).json({ error: "subscription_required", message: "\u0414\u0430\u043D\u043D\u044B\u0435 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B \u043F\u043E \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0435." });
api.get("/search/:id", requireAuth, h2(async (req, res) => {
  const rec = await getSearch(String(req.params.id), req.user.id);
  if (!rec) return void res.status(404).json({ error: "not_found" });
  res.json(view(rec, req.user));
}));
api.get("/search/:id/rows", requireAuth, h2(async (req, res) => {
  if (!isSubscribed(req.user)) {
    const exists = await getSearch(String(req.params.id), req.user.id);
    return void (exists ? needSub(res) : res.status(404).json({ error: "not_found" }));
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
api.get("/search/:id/export.csv", requireAuth, h2(async (req, res) => {
  if (!isSubscribed(req.user)) {
    const exists = await getSearch(String(req.params.id), req.user.id);
    return void (exists ? needSub(res) : res.status(404).json({ error: "not_found" }));
  }
  const rec = await getSearch(String(req.params.id), req.user.id, true);
  if (!rec) return void res.status(404).json({ error: "not_found" });
  const rows = getRows(rec, 0, rec.rowsTotal);
  const cols = rec.kind === "maps" ? [["\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435", (r) => r.name], ["\u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F", (r) => r.category], ["\u0410\u0434\u0440\u0435\u0441", (r) => r.address], ["\u0422\u0435\u043B\u0435\u0444\u043E\u043D", (r) => r.phone], ["\u0420\u0435\u0439\u0442\u0438\u043D\u0433", (r) => r.rating], ["\u041E\u0442\u0437\u044B\u0432\u043E\u0432", (r) => r.reviews], ["\u0421\u0441\u044B\u043B\u043A\u0430 2\u0413\u0418\u0421", (r) => r.url]] : [["Username", (r) => r.username], ["\u0418\u043C\u044F", (r) => r.name], ["\u0427\u0430\u0442", (r) => r.chat], ["\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435", (r) => r.text], ["\u0414\u0430\u0442\u0430", (r) => r.date], ["\u0421\u0441\u044B\u043B\u043A\u0430", (r) => r.link]];
  const csv = "\uFEFF" + [cols.map((c) => csvCell(c[0])).join(";"), ...rows.map((r) => cols.map((c) => csvCell(c[1](r))).join(";"))].join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="fracs-${rec.kind}-${rec.id.slice(0, 8)}.csv"`);
  res.send(csv);
}));
api.post("/payments/create", requireAuth, h2(async (req, res) => {
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
