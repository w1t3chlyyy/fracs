import crypto from 'node:crypto';
import { config, loadTokenPacks } from './config.ts';
import {
  claimPayment, extendSubscription, findPaymentByProviderId, getPlans, getUser, insertPayment,
  newId, aiTokensAdd, revertPayment, setPaymentProviderId, type PaymentRecord, type User,
} from './db.ts';
import { notify } from './bot.ts';
import { safeEqual } from './util.ts';

export type PaymentMethod = 'cryptobot' | 'xrocket';

const CRYPTOBOT_API = 'https://pay.crypt.bot/api';
const XROCKET_API = 'https://pay.ton-rocket.com';

async function activate(p: PaymentRecord) {
  const [user, plans] = await Promise.all([getUser(p.userId), getPlans()]);
  // Пакет токенов Fracs AI — разовая покупка, баланс не истекает вместе с подпиской.
  const pack = loadTokenPacks().find((t) => t.id === p.planId);
  if (pack) {
    if (!user) return;
    if (!(await claimPayment(p.id))) return;
    try {
      await aiTokensAdd(user.id, pack.tokens);
      await notify(user.tgId, `⚡️ Токены Fracs AI зачислены: +${pack.tokens.toLocaleString('ru-RU')}. Баланс не истекает — смотрите остаток в кабинете: ${config.appUrl}/app`);
    } catch (e) {
      await revertPayment(p.id);
      throw e;
    }
    return;
  }
  const plan = plans.find((x) => x.id === p.planId);
  if (!user || !plan) return;
  if (!(await claimPayment(p.id))) return;
  try {
    const updated = await extendSubscription(user.id, plan.days, plan.id);
    await notify(user.tgId, `✅ Подписка активна до ${new Date(updated.subscriptionUntil!).toLocaleDateString('ru-RU')}. Данные открыты в кабинете: ${config.appUrl}/app`);
  } catch (e) {
    await revertPayment(p.id);
    throw e;
  }
}

async function getUsdtRubRate(): Promise<number> {
  try {
    const r = await fetch('https://api.coinbase.com/v2/exchange-rates?currency=USDT', {
      signal: AbortSignal.timeout(2500),
    });
    if (r.ok) {
      const j: any = await r.json();
      const rub = Number(j?.data?.rates?.RUB);
      if (Number.isFinite(rub) && rub > 20 && rub < 500) return rub;
    }
  } catch {
    /* fallback to configured rate */
  }
  return Number.isFinite(config.usdtRubRate) && config.usdtRubRate > 0 ? config.usdtRubRate : 95;
}

export async function createPayment(
  user: User,
  planId: string,
  method?: PaymentMethod,
): Promise<{ paymentId: string; confirmationUrl?: string; activated?: boolean }> {
  const pack = loadTokenPacks().find((t) => t.id === planId);
  const plans = pack ? [] : await getPlans();
  const plan = pack ? undefined : plans.find((p) => p.id === planId);
  if (!pack && !plan) throw Object.assign(new Error('Неизвестный тариф'), { status: 400 });

  const chosen: PaymentMethod =
    method === 'cryptobot' || method === 'xrocket' ? method : config.paymentProvider;
  const amountRub = pack ? pack.priceRub : plan!.priceRub;
  const title = pack ? `Токены Fracs AI: ${pack.title}` : `Подписка Fracs: ${plan!.title}`;

  const rec: PaymentRecord = {
    id: newId(),
    userId: user.id,
    planId: (pack ?? plan!).id,
    amountRub,
    status: 'pending',
    provider: chosen,
    providerId: null,
    createdAt: new Date().toISOString(),
    paidAt: null,
  };
  await insertPayment(rec);

  if (chosen === 'cryptobot') {
    if (!config.cryptobotToken) {
      throw Object.assign(new Error('Оплата через CryptoBot не настроена. Выберите «Реквизиты» для оплаты через @HelpManage.'), { status: 503 });
    }
    const resp = await fetch(`${CRYPTOBOT_API}/createInvoice`, {
      method: 'POST',
      headers: {
        'Crypto-Pay-API-Token': config.cryptobotToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        currency_type: 'fiat',
        fiat: 'RUB',
        amount: String(amountRub),
        accepted_assets: 'USDT,TON,BTC,ETH,LTC,BNB,TRX,USDC',
        description: title,
        payload: rec.id,
        paid_btn_name: 'callback',
        paid_btn_url: `${config.appUrl}/app?paid=1`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json: any = await resp.json().catch(() => ({}));
    if (!resp.ok || !json?.ok || !json?.result) {
      throw new Error(`CryptoBot: ${json?.error?.name || resp.status}`);
    }
    await setPaymentProviderId(rec.id, String(json.result.invoice_id));
    const confirmationUrl = json.result.bot_invoice_url || json.result.web_app_invoice_url || json.result.mini_app_invoice_url;
    return { paymentId: rec.id, confirmationUrl };
  }

  if (!config.xrocketKey) {
    throw Object.assign(new Error('Оплата через xRocket не настроена. Выберите «Реквизиты» для оплаты через @HelpManage.'), { status: 503 });
  }
  const rate = await getUsdtRubRate();
  const usdtAmount = Math.max(0.1, Math.round((amountRub / rate) * 100) / 100);
  const resp = await fetch(`${XROCKET_API}/tg-invoices`, {
    method: 'POST',
    headers: {
      'Rocket-Pay-Key': config.xrocketKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: usdtAmount,
      minPayment: usdtAmount,
      numPayments: 1,
      currency: 'USDT',
      description: `${title} (${amountRub} ₽)`,
      callbackUrl: `${config.appUrl}/app?paid=1`,
      payload: rec.id,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json: any = await resp.json().catch(() => ({}));
  if (!resp.ok || !json?.success || !json?.data?.link) {
    throw new Error(`xRocket: ${json?.message || resp.status}`);
  }
  await setPaymentProviderId(rec.id, String(json.data.id));
  return { paymentId: rec.id, confirmationUrl: String(json.data.link) };
}

/** Проверка подписи CryptoBot webhook: HMAC-SHA256(SHA256(token), rawBody). */
function verifyCryptoBotSig(rawBody: Buffer | undefined, signature: string): boolean {
  if (!config.cryptobotToken || !rawBody || !signature) return false;
  const secret = crypto.createHash('sha256').update(config.cryptobotToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(expected, signature.toLowerCase());
}

export async function handleCryptoBotWebhook(body: any, rawBody?: Buffer, signature = '') {
  if (!verifyCryptoBotSig(rawBody, signature)) return;
  if (body?.update_type !== 'invoice_paid') return;
  const inv = body?.payload;
  const invoiceId = inv?.invoice_id;
  if (invoiceId == null) return;

  const rec = await findPaymentByProviderId(String(invoiceId));
  if (!rec || rec.status !== 'pending') return;

  // Перепроверяем статус счёта напрямую через CryptoBot API
  const checkResp = await fetch(`${CRYPTOBOT_API}/getInvoices`, {
    method: 'POST',
    headers: { 'Crypto-Pay-API-Token': config.cryptobotToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoice_ids: String(invoiceId) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!checkResp.ok) return;
  const checkJson: any = await checkResp.json().catch(() => ({}));
  const real = checkJson?.result?.items?.[0];
  if (real?.status === 'paid' && String(real.payload || '') === rec.id) {
    await activate(rec);
  }
}

function verifyXRocketSig(
  rawBody: Buffer | undefined,
  headers: { legacySig?: string; signature?: string; timestamp?: string },
): boolean {
  if (!rawBody) return false;
  const legacySig = (headers.legacySig || '').trim();
  const signature = (headers.signature || '').trim();
  const timestamp = (headers.timestamp || '').trim();

  // Современная схема xRocket Pay API: Signature + Signature-Timestamp + XROCKET_WEBHOOK_TOKEN
  if (config.xrocketWebhookToken && signature && timestamp) {
    const tsNum = Number(timestamp);
    if (!Number.isFinite(tsNum)) return false;
    const tsSec = tsNum > 1e12 ? tsNum / 1000 : tsNum;
    if (Math.abs(Date.now() / 1000 - tsSec) > 300) return false;
    const payload = `${timestamp}.${rawBody.toString('utf8')}`;
    const hmacHex = crypto.createHmac('sha256', config.xrocketWebhookToken).update(payload, 'utf8').digest('hex');
    const hmacB64 = crypto.createHmac('sha256', config.xrocketWebhookToken).update(payload, 'utf8').digest('base64');
    if (safeEqual(hmacHex, signature.toLowerCase()) || safeEqual(hmacB64, signature)) return true;
  }

  // Альтернативная/legacy схема: Rocket-Pay-Signature = HMAC-SHA256(SHA256(key), rawBody)
  if (legacySig) {
    for (const key of [config.xrocketWebhookToken, config.xrocketKey].filter(Boolean)) {
      const secret = crypto.createHash('sha256').update(key).digest();
      const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      if (safeEqual(expected, legacySig.toLowerCase())) return true;
    }
    return false;
  }

  // Если задан XROCKET_WEBHOOK_TOKEN, подпись обязательна
  return !config.xrocketWebhookToken;
}

/** Проверка подписи xRocket webhook (Webhook Token / API Key) + проверка статуса счёта через API. */
export async function handleXRocketWebhook(
  body: any,
  rawBody?: Buffer,
  headers: { legacySig?: string; signature?: string; timestamp?: string } = {},
) {
  if (!config.xrocketKey) return;
  if (!verifyXRocketSig(rawBody, headers)) return;

  const invoiceId = body?.data?.id ?? body?.invoice?.id ?? body?.invoice_id ?? body?.id;
  if (invoiceId == null) return;

  const rec = await findPaymentByProviderId(String(invoiceId));
  if (!rec || rec.status !== 'pending') return;

  const checkResp = await fetch(`${XROCKET_API}/tg-invoices/${encodeURIComponent(String(invoiceId))}`, {
    headers: { 'Rocket-Pay-Key': config.xrocketKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!checkResp.ok) return;
  const checkJson: any = await checkResp.json().catch(() => ({}));
  const real = checkJson?.data;
  if (real?.status === 'paid' && String(real.payload || '') === rec.id) {
    await activate(rec);
  }
}
