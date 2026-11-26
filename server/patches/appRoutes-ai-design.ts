// Копия блоков, добавленных в server/appRoutes.ts + server/aiDesign.ts (для просмотра).
// См. также: server/aiDesign.ts (промт + каталог библиотек), supabase/ai_tokens.sql (миграция).


// ── Импорты в appRoutes.ts ──────────────────────────────────────────────────
// import { config, TOKEN_PACKS, loadTokenPacks } from './config.ts';
// import { …, aiTokensGet, aiTokensSpend, … } from './db.ts';
// import { DESIGN_VERSION, DESIGN_LIBRARIES, FRACS_DESIGN_SYSTEM } from './aiDesign.ts';

// ── Лимиты: добавлена дневная квота токенов + купленные пакеты ──────────────
// const AI_LIMITS = {
//   …,
//   dailyTokens: envNum('AI_DAILY_TOKENS', 150_000),  // включённая дневная квота (~7 генераций сайта)
// };

// ── POST /ai: дизайн-система + квота токенов ────────────────────────────────
// После sanitizeAiBody, до лимитов частоты:
//
//   // 0) Дизайн-система против «нейрослопа»: подмешиваем system сервером.
//   const DESIGN_MARKER = 'DESIGN_SYSTEM_VERSION:';
//   let designChars = 0;
//   const hasDesign = body.messages.some((m: any) => m.role === 'system' && typeof m.content === 'string' && m.content.includes(DESIGN_MARKER));
//   if (!hasDesign) {
//     const sys = `DESIGN_SYSTEM_VERSION: ${DESIGN_VERSION}\n` + FRACS_DESIGN_SYSTEM;
//     body.messages.unshift({ role: 'system', content: sys });
//     designChars = sys.length;
//   }
//   const totalInChars = inChars + designChars;
//
//   // 2) лимит по токенам: включённая дневная квота + купленные пакеты (не истекают)
//   const worstTokens = Math.round(totalInChars / 3.5) + body.max_tokens;
//   let usage; let balance = 0;
//   try { usage = await aiUsageToday(uid); balance = await aiTokensGet(uid); } catch { → 503 }
//   const tokensAllowed = AI_LIMITS.dailyTokens + balance;
//   if (usage.userTokens + worstTokens > tokensAllowed) {
//     → 429 { error: 'quota_tokens', message: '…купите токены в кабинете…', tokensLeft, buyUrl }
//   }
//
// После успешного ответа модели (вместе с aiUsageAdd):
//   const over = Math.max(0, usage.userTokens + tokens - AI_LIMITS.dailyTokens);
//   if (over > 0) await aiTokensSpend(uid, over).catch(…);

// ── GET /ai/usage — остаток токенов для программы и кабинета ────────────────
appRouter.get('/ai/usage', h(async (req, res) => {
  if (!(await rateLimit(`app-ai-usage:${req.ip}`, 120, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, reason: 'rate_limited' });
  }
  const gate = await fracsAiGate(req);
  if ('error' in gate) return void res.status(gate.error[0]).json(gate.error[1]);
  try {
    const [usage, balance] = await Promise.all([aiUsageToday(String(gate.user.id)), aiTokensGet(String(gate.user.id))]);
    const allowed = AI_LIMITS.dailyTokens + balance;
    res.json({
      ok: true,
      dailyIncluded: AI_LIMITS.dailyTokens,
      usedToday: usage.userTokens,
      requestsToday: usage.userRequests,
      balance,
      tokensLeft: Math.max(0, allowed - usage.userTokens),
      packs: loadTokenPacks(),
    });
  } catch (e) {
    console.error('[ai] usage endpoint failed:', e);
    res.status(503).json({ ok: false, error: 'usage_unavailable' });
  }
}));

// ── GET /ai/design — промт + каталог библиотек (обновляется без пересборки программы) ──
appRouter.get('/ai/design', h(async (req, res) => {
  if (!(await rateLimit(`app-ai-design:${req.ip}`, 60, 10 * 60_000, true))) {
    return void res.status(429).json({ ok: false, reason: 'rate_limited' });
  }
  const gate = await fracsAiGate(req);
  if ('error' in gate) return void res.status(gate.error[0]).json(gate.error[1]);
  res.json({
    ok: true,
    version: DESIGN_VERSION,
    system: `DESIGN_SYSTEM_VERSION: ${DESIGN_VERSION}\n` + FRACS_DESIGN_SYSTEM,
    libraries: DESIGN_LIBRARIES,
  });
}));
