// Копия блока, добавленного в server/appRoutes.ts (для просмотра)


// ═════════════════════════════════════════════════════════════════════════════
// Fracs AI: прокси к OpenRouter (apply_fixes.py, обновление 9).
// Ключ OpenRouter хранится ТОЛЬКО на сервере (config.openrouterApiKey); программа
// шлёт чат на /api/app/ai с лицензионным ключом в Authorization. Доступ — фича
// 'fracs_ai' тарифа Ultra. Модели — GET /api/app/ai/models (кэш 10 минут).
// ═════════════════════════════════════════════════════════════════════════════
const OR_MODELS_TTL = 10 * 60_000;
let orModelsCache: { at: number; list: any[] } = { at: 0, list: [] };

function orAuthKey(req: any): string {
  // Ключ лицензии программы: Authorization: Bearer <license_key>
  const h = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (h) return h;
  // Фолбэк: { key: ... } в теле (единый стиль остальных /api/app эндпоинтов).
  const k = req.body?.key;
  return typeof k === 'string' ? k.trim() : '';
}

async function fracsAiGate(req: any): Promise<{ user: any } | { error: [number, any] }> {
  const uid = orAuthKey(req);
  if (!uid || uid.length > 128) return { error: [401, { ok: false, reason: 'invalid' }] };
  const user = await getUser(uid);
  if (!user) return { error: [401, { ok: false, reason: 'invalid' }] };
  if (!isSubscribed(user)) return { error: [402, { ok: false, reason: 'expired' }] };
  if (!(await checkChannelSubs(user.tgId))) return { error: [403, { ok: false, reason: 'channels_required' }] };
  const features = await getActiveFeatures(user);
  if (!features.includes('fracs_ai') && !features.includes('ai')) {
    return { error: [402, { ok: false, error: 'fracs_ai_required', message: 'Fracs AI доступен на тарифе Ultra. Оформите Ultra в кабинете.' }] };
  }
  return { user };
}

// ── Лимиты Fracs AI (ключ OpenRouter — ваш, поэтому всё считаем на сервере) ──────────────
// Клиентским лимитам верить нельзя: программа работает на чужом ПК. Свой API-ключ
// пользователя сюда вообще не попадает — он ходит напрямую к провайдеру и без лимитов.
// Все пороги меняются переменными окружения (значения по умолчанию — ниже).
const envNum = (k: string, d: number) => { const n = Number(process.env[k]); return Number.isFinite(n) && n > 0 ? n : d; };
const AI_LIMITS = {
  perMinute: envNum('AI_USER_PER_MIN', 4),          // всплеск: не больше N запросов в минуту
  perHour: envNum('AI_USER_PER_HOUR', 12),          // …в час
  perDay: envNum('AI_USER_PER_DAY', 30),            // …в сутки (генерация + правки + фразы)
  userDailyUsd: envNum('AI_USER_DAILY_USD', 1.5),   // потолок расходов на одного пользователя в сутки
  globalDailyUsd: envNum('AI_GLOBAL_DAILY_USD', 40), // аварийный предохранитель: общий бюджет в сутки
  maxTokens: envNum('AI_MAX_TOKENS', 12000),        // потолок ответа модели
  maxInputChars: envNum('AI_MAX_INPUT_CHARS', 40000),
  maxImages: 3,
};
// Только недорогие модели: иначе можно указать в запросе дорогую модель и сжечь баланс.
const AI_MODELS = new Set((process.env.AI_ALLOWED_MODELS ||
  'openai/gpt-4o-mini,anthropic/claude-3.5-haiku,google/gemini-2.0-flash-001,meta-llama/llama-3.3-70b-instruct,deepseek/deepseek-chat,qwen/qwen-2.5-72b-instruct')
  .split(',').map((s) => s.trim()).filter(Boolean));
// $ за 1M токенов (вход, выход) — ПРИБЛИЗИТЕЛЬНО, нужно только для оценки «до запроса»
// и если OpenRouter не вернул фактическую стоимость. Сверяйте с openrouter.ai/models.
const AI_PRICE: Record<string, [number, number]> = {
  'openai/gpt-4o-mini': [0.15, 0.6], 'anthropic/claude-3.5-haiku': [0.8, 4],
  'google/gemini-2.0-flash-001': [0.1, 0.4], 'meta-llama/llama-3.3-70b-instruct': [0.12, 0.3],
  'deepseek/deepseek-chat': [0.3, 0.9], 'qwen/qwen-2.5-72b-instruct': [0.12, 0.39],
};
const priceOf = (model: string): [number, number] => AI_PRICE[model] || [1, 4];
const aiErr = (status: number, error: string, message: string, extra: object = {}): [number, any] => [status, { ok: false, error, message, ...extra }];

/** Чистим тело запроса: только модель из белого списка, без stream/tools/plugins, потолок токенов. */
function sanitizeAiBody(raw: any): { body: any; inChars: number } | { err: [number, any] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { err: aiErr(400, 'bad_request', 'Ожидается тело chat/completions.') };
  const model = String(raw.model || '');
  if (!AI_MODELS.has(model)) return { err: aiErr(400, 'model_not_allowed', 'Эта модель недоступна во встроенном Fracs AI. Выберите модель из списка или подключите свой API-ключ.') };
  const msgs = raw.messages;
  if (!Array.isArray(msgs) || msgs.length < 1 || msgs.length > 6) return { err: aiErr(400, 'bad_request', 'Некорректный список сообщений.') };
  let chars = 0, images = 0;
  const messages: any[] = [];
  for (const m of msgs) {
    const role = String(m?.role || '');
    if (!['system', 'user', 'assistant'].includes(role)) return { err: aiErr(400, 'bad_request', 'Некорректная роль сообщения.') };
    if (typeof m.content === 'string') {
      chars += m.content.length;
      messages.push({ role, content: m.content });
    } else if (Array.isArray(m.content)) {
      const parts: any[] = [];
      for (const p of m.content) {
        if (p?.type === 'text' && typeof p.text === 'string') { chars += p.text.length; parts.push({ type: 'text', text: p.text }); }
        else if (p?.type === 'image_url' && typeof p.image_url?.url === 'string' && /^data:image\/(png|jpe?g|webp);base64,/i.test(p.image_url.url)) {
          if (++images > AI_LIMITS.maxImages) return { err: aiErr(400, 'too_many_images', `Не больше ${AI_LIMITS.maxImages} картинок в запросе.`) };
          parts.push({ type: 'image_url', image_url: { url: p.image_url.url } });
        } else return { err: aiErr(400, 'bad_request', 'Неподдерживаемый тип содержимого.') };
      }
      messages.push({ role, content: parts });
    } else return { err: aiErr(400, 'bad_request', 'Пустое сообщение.') };
  }
  if (chars > AI_LIMITS.maxInputChars) return { err: aiErr(413, 'input_too_long', `Запрос слишком длинный (лимит ${AI_LIMITS.maxInputChars} символов). Сократите промт или вложения.`) };
  const reqTok = Number(raw.max_tokens);
  const maxTokens = Math.min(AI_LIMITS.maxTokens, Number.isFinite(reqTok) && reqTok > 0 ? Math.floor(reqTok) : AI_LIMITS.maxTokens);
  const temp = Number(raw.temperature);
  return {
    inChars: chars,
    body: { model, messages, max_tokens: maxTokens, temperature: Number.isFinite(temp) ? Math.min(1.2, Math.max(0, temp)) : 0.7, stream: false, usage: { include: true } },
  };
}

appRouter.post('/ai', h(async (req, res) => {
  if (!(await rateLimit(`app-ai:${req.ip}`, 240, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, reason: 'rate_limited' });
  }
  const gate = await fracsAiGate(req);
  if ('error' in gate) return void res.status(gate.error[0]).json(gate.error[1]);
  if (!config.openrouterApiKey) {
    return void res.status(503).json({ ok: false, error: 'not_configured', message: 'Fracs AI временно недоступен. Попробуйте позже.' });
  }
  const uid = String(gate.user.id);
  const clean = sanitizeAiBody(req.body?.body ?? req.body);
  if ('err' in clean) return void res.status(clean.err[0]).json(clean.err[1]);
  const { body, inChars } = clean;

  // 1) частота: минута / час / сутки (failClosed — при сбое счётчика не пускаем)
  if (!(await rateLimit(`ai-u-min:${uid}`, AI_LIMITS.perMinute, 60_000, true))) {
    return void res.status(429).json({ ok: false, error: 'quota_minute', message: 'Слишком часто. Подождите минуту и повторите.' });
  }
  if (!(await rateLimit(`ai-u-hr:${uid}`, AI_LIMITS.perHour, 3_600_000, true))) {
    return void res.status(429).json({ ok: false, error: 'quota_hour', message: `Лимит Fracs AI: ${AI_LIMITS.perHour} запросов в час. Продолжите позже или подключите свой API-ключ — без лимитов.` });
  }
  if (!(await rateLimit(`ai-u-day:${uid}`, AI_LIMITS.perDay, 86_400_000, true))) {
    return void res.status(429).json({ ok: false, error: 'quota_day', message: `Лимит Fracs AI на сутки исчерпан (${AI_LIMITS.perDay} запросов). Он обновится завтра. С собственным API-ключом лимитов нет.` });
  }

  // 2) бюджет в долларах: по пользователю и общий. Худший случай этого запроса учитываем заранее.
  const [pin, pout] = priceOf(body.model);
  const worstUsd = (inChars / 3.5) * pin / 1e6 + body.max_tokens * pout / 1e6;
  let usage;
  try { usage = await aiUsageToday(uid); } catch (e) {
    console.error('[ai] usage read failed — запрос отклонён (предохранитель):', e);
    return void res.status(503).json({ ok: false, error: 'budget_unavailable', message: 'Fracs AI временно недоступен. Попробуйте позже или используйте свой API-ключ.' });
  }
  if (usage.totalCostUsd + worstUsd > AI_LIMITS.globalDailyUsd) {
    return void res.status(503).json({ ok: false, error: 'daily_budget', message: 'Общий лимит Fracs AI на сегодня исчерпан — он обновится завтра. Со своим API-ключом можно работать без ограничений.' });
  }
  if (usage.userCostUsd + worstUsd > AI_LIMITS.userDailyUsd) {
    return void res.status(429).json({ ok: false, error: 'quota_budget', message: 'Дневной лимит Fracs AI по объёму генерации исчерпан. Он обновится завтра. Со своим API-ключом лимитов нет.' });
  }

  try {
    const upstream = await fetch(config.openrouterUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openrouterApiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(170_000),
    });
    const text = await upstream.text();
    if (upstream.ok) {
      // фактический расход: cost от OpenRouter, иначе по токенам и таблице цен
      try {
        const u = JSON.parse(text)?.usage || {};
        const tokens = Number(u.total_tokens) || (Number(u.prompt_tokens) || 0) + (Number(u.completion_tokens) || 0);
        const cost = Number(u.cost) > 0 ? Number(u.cost)
          : ((Number(u.prompt_tokens) || inChars / 3.5) * pin + (Number(u.completion_tokens) || body.max_tokens) * pout) / 1e6;
        await aiUsageAdd(uid, tokens, cost);
      } catch (e) { console.error('[ai] usage write failed:', e); }
    }
    res.status(upstream.status).type('application/json').send(text);
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'upstream', message: 'Fracs AI временно недоступен. Попробуйте позже.' });
  }
}));

appRouter.get('/ai/models', h(async (req, res) => {
  if (!(await rateLimit(`app-ai-models:${req.ip}`, 120, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, reason: 'rate_limited' });
  }
  const gate = await fracsAiGate(req);
  if ('error' in gate) return void res.status(gate.error[0]).json(gate.error[1]);
  if (!config.openrouterApiKey) {
    return void res.status(503).json({ ok: false, error: 'not_configured' });
  }
  // отдаём только разрешённые модели — программа не покажет (и не попросит) дорогие
  const onlyAllowed = (d: any) => ({ ...d, data: (Array.isArray(d?.data) ? d.data : []).filter((m: any) => AI_MODELS.has(String(m?.id))) });
  if (orModelsCache.list.length && Date.now() - orModelsCache.at < OR_MODELS_TTL) {
    return void res.json(onlyAllowed(orModelsCache.list));
  }
  try {
    const upstream = await fetch(config.openrouterUrl + '/models', {
      headers: { Authorization: `Bearer ${config.openrouterApiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.ok) return void res.status(502).json({ ok: false, error: 'upstream' });
    const data = await upstream.json();
    orModelsCache = { at: Date.now(), list: data };
    res.json(onlyAllowed(data));
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'upstream' });
  }
}));
