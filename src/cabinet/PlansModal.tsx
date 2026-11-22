import { useState } from 'react';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import { api } from './api';
import type { AppConfig } from './types';

const FEATURE_LABELS: Record<string, string> = {
  owners: 'Поиск владельцев (руководитель / ИП, ИНН, контакты)',
  training: 'Раздел «Обучение»',
};

export default function PlansModal({ config, onClose, onActivated }: { config: AppConfig; onClose: () => void; onActivated: () => void }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const pay = async (planId: string) => {
    setBusy(planId);
    setError('');
    try {
      // Оплата через админа: уведомляем его в боте и открываем чат с готовым текстом
      if (config.adminUsername) {
        const plan = config.plans.find((p) => p.id === planId)!;
        await api.requestPlan(planId).catch(() => {});
        const text = `Здравствуйте! Хочу оформить подписку Fracs: ${plan.title} (${plan.priceRub.toLocaleString('ru-RU')} ₽).`;
        window.open(`https://t.me/${config.adminUsername}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
        setBusy('');
        return;
      }
      const r = await api.pay(planId);
      if (r.confirmationUrl) window.location.href = r.confirmationUrl;
      else if (r.activated) onActivated();
    } catch (e: any) {
      setError(e.message || 'Не удалось создать платёж');
      setBusy('');
    }
  };

  const note = config.adminUsername
    ? 'Выберите тариф: откроется чат с администратором в Telegram. После оплаты он активирует подписку, а бот пришлёт вам уведомление.'
    : config.payment === 'yookassa'
      ? 'Оплата проходит на стороне ЮKassa. После оплаты вы вернётесь в кабинет, где откроется загрузка программы.'
      : 'Тестовый режим: подписка выдаётся без реальной оплаты.';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div onClick={onClose} className="absolute inset-0 bg-black/70" />
      <div role="dialog" aria-modal="true" aria-label="Подписка" className="relative z-10 ember-glass rounded-2xl w-full max-w-lg p-6 sm:p-8 shadow-2xl">
        <button onClick={onClose} aria-label="Закрыть" className="absolute top-4 right-4 w-8 h-8 rounded-full bg-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.16)] text-[#d9c4b5] flex items-center justify-center cursor-pointer">
          <X className="w-4 h-4" />
        </button>
        <h3 className="font-heading text-2xl font-medium text-[#fbf3ea]">Подписка Fracs</h3>
        <ul className="mt-3 space-y-1.5 text-[14px] text-[#d9c4b5]">
          {[
            'Программа Fracs Parser для Windows, macOS и Linux: реальный парсинг 2ГИС на вашем ПК',
            'Фильтры, шаблоны WhatsApp, выгрузка HTML / CSV / XLSX / JSON, Яндекс Карты',
            'Контакты и выгрузки по Telegram-поискам в кабинете',
          ].map((t) => (
            <li key={t} className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />{t}</li>
          ))}
        </ul>

        <div className="mt-6 grid gap-3">
          {config.plans.map((p) => {
            const extras = (p.features ?? []).filter((f) => FEATURE_LABELS[f]);
            return (
            <button key={p.id} onClick={() => pay(p.id)} disabled={!!busy} className="flex items-center justify-between gap-4 p-4 rounded-2xl border border-[rgba(255,178,124,0.14)] bg-[rgba(255,255,255,0.02)] hover:border-[#F26522] text-left transition-colors cursor-pointer disabled:opacity-60">
              <div>
                <p className="font-medium text-[#fbf3ea]">{p.title}</p>
                {p.badge && <p className="text-[12px] text-[#F26522] mt-0.5">{p.badge}</p>}
                {p.description && <p className="text-[12.5px] text-[#a08c7c] mt-1 leading-snug">{p.description}</p>}
                {extras.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {extras.map((f) => (
                      <li key={f} className="flex items-start gap-1.5 text-[12px] text-[#d9c4b5]"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />{FEATURE_LABELS[f]}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-heading text-xl font-semibold text-[#fbf3ea]">{p.priceRub.toLocaleString('ru-RU')} ₽</span>
                {busy === p.id && <Loader2 className="w-4 h-4 animate-spin text-[#a08c7c]" />}
              </div>
            </button>
            );
          })}
        </div>

        {error && <p className="text-[13px] text-[#ff8a5b] mt-3">{error}</p>}
        <p className="text-[12px] text-[#a08c7c] mt-4">{note}</p>
        <p className="text-[12px] text-[#a08c7c] mt-2">
          Оплачивая подписку, вы принимаете условия{' '}
          <a href="/offer" target="_blank" rel="noreferrer" className="text-[#d9c4b5] underline underline-offset-2 hover:text-[#fbf3ea]">
            публичной оферты
          </a>,{' '}
          <a href="/terms" target="_blank" rel="noreferrer" className="text-[#d9c4b5] underline underline-offset-2 hover:text-[#fbf3ea]">
            пользовательского соглашения
          </a>{' '}
          и{' '}
          <a href="/privacy" target="_blank" rel="noreferrer" className="text-[#d9c4b5] underline underline-offset-2 hover:text-[#fbf3ea]">
            политики конфиденциальности
          </a>.
        </p>
      </div>
    </div>
  );
}
