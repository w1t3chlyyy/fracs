import { config, PLANS } from './config.ts';
import { data, extendSubscription, newId, save, type PaymentRecord, type User } from './db.ts';
import { notify } from './bot.ts';

const YK = 'https://api.yookassa.ru/v3/payments';
const ykAuth = () => 'Basic ' + Buffer.from(`${config.yookassaShopId}:${config.yookassaSecret}`).toString('base64');

function activate(p: PaymentRecord) {
  if (p.status === 'succeeded') return; // идемпотентность: повторный вебхук ничего не продлит
  const user = data.users.find((u) => u.id === p.userId);
  const plan = PLANS.find((x) => x.id === p.planId);
  if (!user || !plan) return;
  p.status = 'succeeded';
  p.paidAt = new Date().toISOString();
  extendSubscription(user, plan.days);
  save();
  notify(user.tgId, `✅ Подписка активна до ${new Date(user.subscriptionUntil!).toLocaleDateString('ru-RU')}. Данные открыты в кабинете: ${config.appUrl}/app`);
}

export async function createPayment(user: User, planId: string): Promise<{ confirmationUrl?: string; activated?: boolean }> {
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) throw Object.assign(new Error('Неизвестный тариф'), { status: 400 });

  const rec: PaymentRecord = {
    id: newId(), userId: user.id, planId: plan.id, amountRub: plan.priceRub, status: 'pending',
    provider: config.paymentProvider, providerId: null, createdAt: new Date().toISOString(), paidAt: null,
  };
  data.payments.push(rec);
  save();

  if (config.paymentProvider === 'yookassa') {
    if (!config.yookassaShopId || !config.yookassaSecret) throw new Error('ЮKassa не настроена');
    const resp = await fetch(YK, {
      method: 'POST',
      headers: { Authorization: ykAuth(), 'Idempotence-Key': rec.id, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: { value: plan.priceRub.toFixed(2), currency: 'RUB' },
        capture: true,
        confirmation: { type: 'redirect', return_url: `${config.appUrl}/app?paid=1` },
        description: `Подписка Fracs: ${plan.title}`,
        metadata: { paymentId: rec.id },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const json: any = await resp.json();
    if (!resp.ok) throw new Error(`ЮKassa: ${json?.description || resp.status}`);
    rec.providerId = json.id;
    save();
    return { confirmationUrl: json.confirmation?.confirmation_url };
  }

  if (!config.allowMockPayments) throw Object.assign(new Error('Оплата не настроена'), { status: 503 });
  activate(rec); // тестовый режим: подписка выдаётся сразу
  return { activated: true };
}

/** Вебхук ЮKassa не подписан, поэтому статус и сумму перепроверяем запросом к API. */
export async function handleYookassaWebhook(body: any) {
  const id = body?.object?.id;
  if (typeof id !== 'string') return;
  const rec = data.payments.find((p) => p.providerId === id);
  if (!rec || rec.status !== 'pending') return;
  const resp = await fetch(`${YK}/${encodeURIComponent(id)}`, { headers: { Authorization: ykAuth() }, signal: AbortSignal.timeout(15000) });
  if (!resp.ok) return;
  const real: any = await resp.json();
  if (real.status === 'canceled') {
    rec.status = 'canceled';
    save();
  } else if (real.status === 'succeeded' && Number(real.amount?.value) === rec.amountRub && real.metadata?.paymentId === rec.id) {
    activate(rec);
  }
}
