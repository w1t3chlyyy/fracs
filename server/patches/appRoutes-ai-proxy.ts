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

appRouter.post('/ai', h(async (req, res) => {
  if (!(await rateLimit(`app-ai:${req.ip}`, 240, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, reason: 'rate_limited' });
  }
  const gate = await fracsAiGate(req);
  if ('error' in gate) return void res.status(gate.error[0]).json(gate.error[1]);
  if (!config.openrouterApiKey) {
    return void res.status(503).json({ ok: false, error: 'not_configured', message: 'Fracs AI не настроен на сервере (нет OPENROUTER_API_KEY).' });
  }
  const body = req.body?.body ?? req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || !String(body.model || '')) {
    return void res.status(400).json({ ok: false, error: 'bad_request', message: 'Ожидается тело chat/completions.' });
  }
  delete (body as any).key; // лицензионный ключ не уходит в OpenRouter
  try {
    const upstream = await fetch(config.openrouterUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openrouterApiKey}` },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    res.status(upstream.status).type('application/json').send(text);
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'upstream', message: 'OpenRouter недоступен: ' + String(e?.message || e) });
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
  if (orModelsCache.list.length && Date.now() - orModelsCache.at < OR_MODELS_TTL) {
    return void res.json(orModelsCache.list);
  }
  try {
    const upstream = await fetch(config.openrouterUrl + '/models', {
      headers: { Authorization: `Bearer ${config.openrouterApiKey}` },
    });
    if (!upstream.ok) return void res.status(502).json({ ok: false, error: 'upstream' });
    const data = await upstream.json();
    orModelsCache = { at: Date.now(), list: data };
    res.json(data);
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'upstream' });
  }
}));
