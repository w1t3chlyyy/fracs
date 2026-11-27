import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { config, loadTokenPacks, type Plan, type PromoCode } from './config.ts';
import { isAdminInitData } from './webapp.ts';
import { notify, resolveChannel } from './bot.ts';
import {
  extendSubscription, findUser, getUser, getPlans, getPromocodes, savePromoCode, deletePromoCode, togglePromoCode,
  getTraining, addLesson, updateLesson, deleteLesson, aiTokensGet, aiTokensAdd, refundBudgetWindow,
  listRecentUsers, resetPlans, setSubscription, updatePlan, getRequiredChannels, setRequiredChannels, type User,
} from './db.ts';

/**
 * Админ-API для Mini App (/admin.html). Все запросы валидируются по Telegram
 * Web App initData (заголовок x-tg-initdata) и проверяются на ADMIN_TG_ID.
 * Слэш-команды в боте остаются как запасной способ; этот API — основное UI.
 */
export const adminRouter = Router();

const h = (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/** 403, если запрос не от админа. */
const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  const initData = req.get('x-tg-initdata') || (req.body && typeof req.body === 'object' ? req.body.initData : '') || '';
  if (!config.adminTgId || !isAdminInitData(initData)) {
    return void res.status(403).json({ error: 'forbidden', message: 'Доступ только для администратора.' });
  }
  next();
};

adminRouter.use(requireAdmin);

const publicUser = (u: User, tokenBalance = 0) => ({
  id: u.id,
  tgId: u.tgId,
  email: u.email,
  username: u.username,
  firstName: u.firstName,
  createdAt: u.createdAt,
  subscriptionUntil: u.subscriptionUntil,
  planId: u.planId,
  active: !!u.subscriptionUntil && Date.parse(u.subscriptionUntil) > Date.now(),
  tokenBalance,
});

const publicPlan = (p: Plan) => ({ id: p.id, title: p.title, priceRub: p.priceRub, days: p.days, badge: p.badge ?? '', description: p.description ?? '', features: p.features ?? [] });

adminRouter.get('/me', h(async (_req, res) => {
  res.json({ ok: true, admin: true, appUrl: config.appUrl });
}));

adminRouter.get('/users', h(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  const users = await listRecentUsers(limit);
  const balances = await Promise.all(users.map((u) => aiTokensGet(u.id).catch(() => 0)));
  res.json({ users: users.map((u, i) => publicUser(u, balances[i])) });
}));

/** Определяет пользователя по любому из идентификаторов: user-id (UUID), Telegram ID или email. */
async function locateUser(body: any): Promise<User | null> {
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  if (id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return await getUser(id);
  const tgId = Number(body?.tgId);
  if (Number.isInteger(tgId) && tgId > 0) return await findUser(String(tgId));
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email) return await findUser(email);
  return null;
}

adminRouter.post('/grant', h(async (req, res) => {
  const days = Math.round(Number(req.body?.days));
  const planId: string | undefined = req.body?.planId || undefined;
  if (!(days > 0 && days <= 3650)) return void res.status(400).json({ error: 'bad_days', message: 'Дней: 1–3650.' });
  const plans = await getPlans();
  if (planId && !plans.some((p) => p.id === planId)) {
    return void res.status(400).json({ error: 'bad_plan', message: `Тариф ${planId} не найден.` });
  }
  const user = await locateUser(req.body);
  if (!user) {
    return void res.status(404).json({ error: 'user_not_found', message: 'Пользователь не найден — пусть сначала войдёт в кабинет (Telegram или код с почты).' });
  }
  const updated = await extendSubscription(user.id, days, planId);
  const balance = await aiTokensGet(updated.id).catch(() => 0);
  try {
    // У email-аккаунта (tgId = null) уведомление в Telegram не уйдёт — notify молча пропустит.
    await notify(updated.tgId, `✅ Подписка Fracs активна до ${new Date(updated.subscriptionUntil!).toLocaleDateString('ru-RU')}. Кабинет: ${config.appUrl}/app`);
  } catch {
    /* уведомление не критично */
  }
  res.json({ user: publicUser(updated, balance) });
}));

adminRouter.post('/revoke', h(async (req, res) => {
  const user = await locateUser(req.body);
  if (!user) return void res.status(404).json({ error: 'user_not_found' });
  const updated = await setSubscription(user.id, null);
  const balance = await aiTokensGet(updated.id).catch(() => 0);
  res.json({ user: publicUser(updated, balance) });
}));

adminRouter.get('/token-packs', h(async (_req, res) => {
  res.json({ packs: loadTokenPacks() });
}));

adminRouter.post('/tokens/grant', h(async (req, res) => {
  const packId = typeof req.body?.packId === 'string' ? req.body.packId.trim() : '';
  const pack = packId ? loadTokenPacks().find((p) => p.id === packId) : undefined;
  const rawTokens = pack ? pack.tokens : Math.round(Number(req.body?.tokens));
  if (!Number.isFinite(rawTokens) || rawTokens < 1 || rawTokens > 50_000_000) {
    return void res.status(400).json({ error: 'bad_tokens', message: 'Укажите пакет или число токенов от 1 до 50 000 000.' });
  }
  const user = await locateUser(req.body);
  if (!user) {
    return void res.status(404).json({ error: 'user_not_found', message: 'Пользователь не найден — пусть сначала войдёт в кабинет (Telegram или код с почты).' });
  }
  await aiTokensAdd(user.id, rawTokens);
  // Сбрасываем возможную блокировку по дневным окнам сложности/фраз, чтобы лимиты заработали сразу.
  await Promise.all([
    refundBudgetWindow(`ai-cx-day:${user.id}`, 10_000),
    refundBudgetWindow(`ai-phrase-day:${user.id}`, 10_000),
  ]).catch(() => {});
  const balance = await aiTokensGet(user.id);
  try {
    await notify(
      user.tgId,
      `⚡️ Лимиты Fracs AI пополнены: +${rawTokens.toLocaleString('ru-RU')} токенов (баланс: ${balance.toLocaleString('ru-RU')}). Перезагрузите AI-вкладку или продолжайте работу: ${config.appUrl}/app`,
    );
  } catch {
    /* уведомление не критично */
  }
  res.json({ user: publicUser(user, balance), granted: rawTokens, tokenBalance: balance });
}));

adminRouter.get('/plans', h(async (_req, res) => {
  const plans = await getPlans();
  res.json({ plans: plans.map(publicPlan) });
}));

adminRouter.post('/plan', h(async (req, res) => {
  const id = String(req.body?.id || '');
  const b = req.body || {};
  const patch: Partial<Pick<Plan, 'title' | 'priceRub' | 'days' | 'badge' | 'description'>> = {};
  if (typeof b.title === 'string') patch.title = b.title.slice(0, 120);
  if (Number.isFinite(Number(b.priceRub))) patch.priceRub = Math.max(0, Math.round(Number(b.priceRub)));
  if (Number.isFinite(Number(b.days))) patch.days = Math.max(1, Math.round(Number(b.days)));
  if (typeof b.badge === 'string') patch.badge = b.badge.slice(0, 60);
  if (typeof b.description === 'string') patch.description = b.description.slice(0, 400);
  const updated = await updatePlan(id, patch);
  if (!updated) return void res.status(404).json({ error: 'plan_not_found' });
  res.json({ plan: publicPlan(updated) });
}));

adminRouter.post('/plans/reset', h(async (_req, res) => {
  const plans = await resetPlans();
  res.json({ plans: plans.map(publicPlan) });
}));

adminRouter.get('/training', h(async (_req, res) => {
  res.json({ lessons: await getTraining() });
}));

adminRouter.post('/training/save', h(async (req, res) => {
  const id: string | undefined = req.body?.id || undefined;
  const title = String(req.body?.title || '').trim();
  const body = String(req.body?.body || '');
  if (!title) return void res.status(400).json({ error: 'bad_title', message: 'Укажите заголовок.' });
  if (id) {
    const lesson = await updateLesson(id, { title, body });
    if (!lesson) return void res.status(404).json({ error: 'lesson_not_found' });
    res.json({ lesson });
  } else {
    res.json({ lesson: await addLesson(title, body) });
  }
}));

adminRouter.post('/training/delete', h(async (req, res) => {
  const id = String(req.body?.id || '');
  if (!id) return void res.status(400).json({ error: 'bad_id' });
  const ok = await deleteLesson(id);
  res.json({ ok });
}));

/* ── обязательные каналы (редактируются из админки; хранятся в app_settings) ── */

adminRouter.get('/channels', h(async (_req, res) => {
  res.json({ channels: await getRequiredChannels() });
}));

adminRouter.post('/channels', h(async (req, res) => {
  const raw = req.body?.channels;
  if (!Array.isArray(raw)) return void res.status(400).json({ error: 'bad_channels', message: 'Ожидается массив строк.' });
  const clean = await setRequiredChannels(raw.map((s: unknown) => String(s)));
  res.json({ channels: clean });
}));

adminRouter.post('/channels/check', h(async (req, res) => {
  const id = String(req.body?.id || '').trim();
  if (!id) return void res.status(400).json({ error: 'bad_id', message: 'Укажите @username или ID канала.' });
  const info = await resolveChannel(id);
  res.json(info);
}));

/* ── промокоды (скидки на тариф; CRUD из админ-панели) ── */

const publicPromoCode = (p: PromoCode) => ({
  id: p.id,
  code: p.code,
  discountPercent: p.discountPercent,
  maxUses: p.maxUses,
  usedCount: p.usedCount,
  validUntil: p.validUntil,
  active: p.active,
  note: p.note,
  createdAt: p.createdAt,
});

adminRouter.get('/promocodes', h(async (_req, res) => {
  const list = await getPromocodes();
  res.json({ promocodes: list.map(publicPromoCode) });
}));

adminRouter.post('/promocodes/save', h(async (req, res) => {
  const b = req.body || {};
  try {
    const promo = await savePromoCode({
      id: typeof b.id === 'string' ? b.id : undefined,
      code: String(b.code || ''),
      discountPercent: Number(b.discountPercent),
      maxUses: Number(b.maxUses),
      validUntil: b.validUntil && String(b.validUntil).trim() ? String(b.validUntil) : null,
      active: Boolean(b.active),
      note: String(b.note || ''),
    });
    res.json({ promo: publicPromoCode(promo) });
  } catch (e: any) {
    res.status(e?.status || 400).json({ error: 'bad_promo', message: e?.message || 'Ошибка промокода' });
  }
}));

adminRouter.post('/promocodes/delete', h(async (req, res) => {
  const id = String(req.body?.id || '');
  if (!id) return void res.status(400).json({ error: 'bad_id' });
  const ok = await deletePromoCode(id);
  res.json({ ok });
}));

adminRouter.post('/promocodes/toggle', h(async (req, res) => {
  const id = String(req.body?.id || '');
  if (!id) return void res.status(400).json({ error: 'bad_id' });
  const promo = await togglePromoCode(id);
  if (!promo) return void res.status(404).json({ error: 'promo_not_found' });
  res.json({ promo: publicPromoCode(promo) });
}));
