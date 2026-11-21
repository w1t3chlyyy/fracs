import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { config, type Plan } from './config.ts';
import { isAdminInitData } from './webapp.ts';
import { notify } from './bot.ts';
import {
  extendSubscription, findUser, getPlans, getTraining, addLesson, updateLesson, deleteLesson,
  listRecentUsers, resetPlans, setSubscription, updatePlan, type User,
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

const publicUser = (u: User) => ({
  id: u.id,
  tgId: u.tgId,
  username: u.username,
  firstName: u.firstName,
  createdAt: u.createdAt,
  subscriptionUntil: u.subscriptionUntil,
  planId: u.planId,
  active: !!u.subscriptionUntil && Date.parse(u.subscriptionUntil) > Date.now(),
});

const publicPlan = (p: Plan) => ({ id: p.id, title: p.title, priceRub: p.priceRub, days: p.days, badge: p.badge ?? '', description: p.description ?? '', features: p.features ?? [] });

adminRouter.get('/me', h(async (_req, res) => {
  res.json({ ok: true, admin: true, appUrl: config.appUrl });
}));

adminRouter.get('/users', h(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  const users = await listRecentUsers(limit);
  res.json({ users: users.map(publicUser) });
}));

adminRouter.post('/grant', h(async (req, res) => {
  const tgId = Number(req.body?.tgId);
  const days = Math.round(Number(req.body?.days));
  const planId: string | undefined = req.body?.planId || undefined;
  if (!Number.isInteger(tgId) || tgId <= 0) return void res.status(400).json({ error: 'bad_tg_id' });
  if (!(days > 0 && days <= 3650)) return void res.status(400).json({ error: 'bad_days', message: 'Дней: 1–3650.' });
  const plans = await getPlans();
  if (planId && !plans.some((p) => p.id === planId)) {
    return void res.status(400).json({ error: 'bad_plan', message: `Тариф ${planId} не найден.` });
  }
  const user = await findUser(String(tgId));
  if (!user) {
    return void res.status(404).json({ error: 'user_not_found', message: 'Пользователь не найден — пусть сначала войдёт в кабинет через бота.' });
  }
  const updated = await extendSubscription(user.id, days, planId);
  try {
    await notify(updated.tgId, `✅ Подписка Fracs активна до ${new Date(updated.subscriptionUntil!).toLocaleDateString('ru-RU')}. Кабинет: ${config.appUrl}/app`);
  } catch {
    /* уведомление не критично */
  }
  res.json({ user: publicUser(updated) });
}));

adminRouter.post('/revoke', h(async (req, res) => {
  const tgId = Number(req.body?.tgId);
  if (!Number.isInteger(tgId) || tgId <= 0) return void res.status(400).json({ error: 'bad_tg_id' });
  const user = await findUser(String(tgId));
  if (!user) return void res.status(404).json({ error: 'user_not_found' });
  const updated = await setSubscription(user.id, null);
  res.json({ user: publicUser(updated) });
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
