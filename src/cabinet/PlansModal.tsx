import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, CreditCard, ExternalLink, Loader2, Rocket, Send, X } from 'lucide-react';
import { api } from './api';
import type { AppConfig } from './types';

const FEATURE_LABELS: Record<string, string> = {
  owners: 'Поиск владельцев (руководитель / ИП, ИНН, контакты)',
  training: 'Раздел «Обучение»',
};

export default function PlansModal({ config, onClose, onActivated }: { config: AppConfig; onClose: () => void; onActivated: () => void }) {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [invoiceUrl, setInvoiceUrl] = useState('');
  const [invoiceProvider, setInvoiceProvider] = useState('');
  const [error, setError] = useState('');

  const selectedPlan = config.plans.find((p) => p.id === selectedPlanId) || null;
  const supportUser = (config.supportUsername || 'HelpManage').replace(/^@/, '');

  // Пока ждём оплату по инвойсу CryptoBot / xRocket — проверяем активацию подписки
  useEffect(() => {
    if (!invoiceUrl) return;
    let stopped = false;
    const t = setInterval(async () => {
      try {
        const m = await api.me();
        if (stopped) return;
        if (m.subscription?.active) {
          clearInterval(t);
          onActivated();
        }
      } catch {
        /* повторим */
      }
    }, 2500);
    return () => { stopped = true; clearInterval(t); };
  }, [invoiceUrl, onActivated]);

  const payWith = async (method: 'cryptobot' | 'xrocket') => {
    if (!selectedPlan) return;
    setBusy(method);
    setError('');
    try {
      const r = await api.pay(selectedPlan.id, method);
      if (r.confirmationUrl) {
        setInvoiceUrl(r.confirmationUrl);
        setInvoiceProvider(method === 'cryptobot' ? 'CryptoBot' : 'xRocket');
        setBusy('');
        return;
      }
      setError('Не удалось получить ссылку на оплату.');
      setBusy('');
    } catch (e: any) {
      setError(e.message || 'Не удалось создать платёж');
      setBusy('');
    }
  };

  const requisitesHref = selectedPlan
    ? `https://t.me/${supportUser}?text=${encodeURIComponent(
        `Здравствуйте! Хочу оплатить подписку Fracs по реквизитам: ${selectedPlan.title} (${selectedPlan.priceRub.toLocaleString('ru-RU')} ₽ / ${selectedPlan.days} дн.).`,
      )}`
    : `https://t.me/${supportUser}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div onClick={onClose} className="absolute inset-0 bg-black/70" />
      <div role="dialog" aria-modal="true" aria-label="Подписка" className="relative z-10 ember-glass rounded-2xl w-full max-w-lg sm:max-w-2xl lg:max-w-5xl max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 sm:p-8 shadow-2xl">
        <button type="button" onClick={onClose} aria-label="Закрыть" className="absolute top-4 right-4 w-8 h-8 rounded-full bg-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.16)] text-[#cccccc] flex items-center justify-center cursor-pointer">
          <X className="w-4 h-4" />
        </button>

        {!selectedPlan ? (
          <>
            <h3 className="font-heading text-xl font-medium text-[#ffffff]">Подписка Fracs</h3>
            <ul className="mt-4 grid gap-2 text-[14px] text-[#cccccc] sm:grid-cols-3 sm:gap-x-6">
              {[
                'Программа Fracs Parser для Windows, macOS и Linux: реальный парсинг 2ГИС на вашем ПК',
                'Фильтры, шаблоны Telegram, выгрузка HTML / CSV / XLSX / JSON, Яндекс Карты',
                'Контакты и выгрузки по Telegram-поискам в кабинете',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />{t}</li>
              ))}
            </ul>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {config.plans.map((p) => {
                const extras = (p.features ?? []).filter((f) => FEATURE_LABELS[f]);
                return (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => { setSelectedPlanId(p.id); setError(''); setInvoiceUrl(''); }}
                    className="flex flex-col justify-between gap-4 p-5 rounded-2xl border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.02)] hover:border-[#F26522] text-left transition-colors cursor-pointer"
                  >
                    <div>
                      <p className="font-medium text-[#ffffff]">{p.title}</p>
                      {p.badge && <p className="text-[12px] text-[#F26522] mt-0.5">{p.badge}</p>}
                      {p.description && <p className="text-[12.5px] text-[#888888] mt-1.5 leading-snug">{p.description}</p>}
                      {extras.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {extras.map((f) => (
                            <li key={f} className="flex items-start gap-1.5 text-[12px] text-[#cccccc]"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />{FEATURE_LABELS[f]}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="font-heading text-xl font-semibold text-[#ffffff]">{p.priceRub.toLocaleString('ru-RU')} ₽</span>
                      <span className="text-[12px] font-medium text-[#F26522]">Выбрать →</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="space-y-6">
            <button
              type="button"
              onClick={() => { setSelectedPlanId(null); setError(''); setInvoiceUrl(''); setBusy(''); }}
              className="inline-flex items-center gap-1.5 text-[13px] text-[#888888] hover:text-[#ffffff] transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" /> К выбору тарифа
            </button>

            <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[rgba(255,255,255,0.1)] pb-4">
              <div>
                <h3 className="font-heading text-xl font-medium text-[#ffffff]">Оплата тарифа «{selectedPlan.title}»</h3>
                <p className="text-[13px] text-[#888888] mt-1">Доступ на {selectedPlan.days} дн. · выберите удобный способ оплаты</p>
              </div>
              <span className="font-heading text-2xl font-semibold text-[#F26522]">{selectedPlan.priceRub.toLocaleString('ru-RU')} ₽</span>
            </div>

            {invoiceUrl ? (
              <div className="rounded-2xl border border-[rgba(242,101,34,0.4)] bg-[rgba(242,101,34,0.08)] p-5 space-y-4">
                <p className="text-[14px] text-[#ffffff]">
                  Счёт на оплату через <strong>{invoiceProvider}</strong> сформирован. Нажмите кнопку ниже, чтобы завершить оплату:
                </p>
                <a
                  href={invoiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2.5 w-full sm:w-auto px-6 py-3 rounded-xl bg-[#F26522] hover:bg-[#e05a1a] text-white text-[14px] font-semibold transition-colors"
                >
                  Перейти к оплате в {invoiceProvider} <ExternalLink className="w-4 h-4" />
                </a>
                <p className="text-[12.5px] text-[#cccccc] flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#F26522]" /> Ждём подтверждения оплаты — подписка активируется автоматически.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => payWith('cryptobot')}
                  disabled={!!busy}
                  className="flex flex-col justify-between gap-3 p-5 rounded-2xl border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.03)] hover:border-[#F26522] text-left transition-colors cursor-pointer disabled:opacity-60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#229ed9]/15 text-[#229ed9]">
                      <Send className="w-4 h-4" />
                    </span>
                    {busy === 'cryptobot' && <Loader2 className="w-4 h-4 animate-spin text-[#F26522]" />}
                  </div>
                  <div>
                    <p className="font-medium text-[#ffffff]">CryptoBot</p>
                    <p className="text-[12px] text-[#888888] mt-1">USDT, TON, BTC, ETH и другие монеты через @CryptoBot</p>
                  </div>
                  <span className="text-[12px] font-medium text-[#F26522]">Оплатить →</span>
                </button>

                <button
                  type="button"
                  onClick={() => payWith('xrocket')}
                  disabled={!!busy}
                  className="flex flex-col justify-between gap-3 p-5 rounded-2xl border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.03)] hover:border-[#F26522] text-left transition-colors cursor-pointer disabled:opacity-60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#F26522]/15 text-[#F26522]">
                      <Rocket className="w-4 h-4" />
                    </span>
                    {busy === 'xrocket' && <Loader2 className="w-4 h-4 animate-spin text-[#F26522]" />}
                  </div>
                  <div>
                    <p className="font-medium text-[#ffffff]">xRocket</p>
                    <p className="text-[12px] text-[#888888] mt-1">Мгновенная оплата в USDT через @xRocket</p>
                  </div>
                  <span className="text-[12px] font-medium text-[#F26522]">Оплатить →</span>
                </button>

                <a
                  href={requisitesHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => { api.requestPlan(selectedPlan.id).catch(() => {}); }}
                  className="flex flex-col justify-between gap-3 p-5 rounded-2xl border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.03)] hover:border-[#F26522] text-left transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
                      <CreditCard className="w-4 h-4" />
                    </span>
                    <ExternalLink className="w-4 h-4 text-[#888888]" />
                  </div>
                  <div>
                    <p className="font-medium text-[#ffffff]">Реквизиты</p>
                    <p className="text-[12px] text-[#888888] mt-1">Оплата переводом — редирект в поддержку @{supportUser} в Telegram</p>
                  </div>
                  <span className="text-[12px] font-medium text-[#F26522]">Написать в @{supportUser} →</span>
                </a>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-[13px] text-[#F26522] mt-4">{error}</p>}
        <p className="text-[12px] text-[#888888] mt-5">
          Доступные способы оплаты: CryptoBot, xRocket или перевод по реквизитам через поддержку{' '}
          <a href={`https://t.me/${supportUser}`} target="_blank" rel="noopener noreferrer" className="text-[#cccccc] underline underline-offset-2 hover:text-[#ffffff]">@{supportUser}</a>.
        </p>
        <p className="text-[12px] text-[#888888] mt-2">
          Оплачивая подписку, вы принимаете условия{' '}
          <a href="/offer" target="_blank" rel="noreferrer" className="text-[#cccccc] underline underline-offset-2 hover:text-[#ffffff]">
            публичной оферты
          </a>,{' '}
          <a href="/terms" target="_blank" rel="noreferrer" className="text-[#cccccc] underline underline-offset-2 hover:text-[#ffffff]">
            пользовательского соглашения
          </a>{' '}
          и{' '}
          <a href="/privacy" target="_blank" rel="noreferrer" className="text-[#cccccc] underline underline-offset-2 hover:text-[#ffffff]">
            политики конфиденциальности
          </a>.
        </p>
      </div>
    </div>
  );
}
