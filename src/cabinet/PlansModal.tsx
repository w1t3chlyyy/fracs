import { useState } from 'react';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import { api } from './api';
import type { AppConfig } from './types';

export default function PlansModal({ config, onClose, onActivated }: { config: AppConfig; onClose: () => void; onActivated: () => void }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const pay = async (planId: string) => {
    setBusy(planId);
    setError('');
    try {
      const r = await api.pay(planId);
      if (r.confirmationUrl) window.location.href = r.confirmationUrl;
      else if (r.activated) onActivated();
    } catch (e: any) {
      setError(e.message || 'Не удалось создать платёж');
      setBusy('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div role="dialog" aria-modal="true" aria-label="Подписка" className="relative z-10 bg-white rounded-2xl w-full max-w-lg p-6 sm:p-8 shadow-2xl">
        <button onClick={onClose} aria-label="Закрыть" className="absolute top-4 right-4 w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center cursor-pointer">
          <X className="w-4 h-4" />
        </button>
        <h3 className="font-heading text-2xl font-medium text-gray-900">Подписка на данные</h3>
        <ul className="mt-3 space-y-1.5 text-[14px] text-gray-600">
          {['Контакты компаний и людей из всех ваших запросов', 'Выгрузка в CSV', 'Без ограничений по числу просмотров'].map((t) => (
            <li key={t} className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />{t}</li>
          ))}
        </ul>

        <div className="mt-6 grid gap-3">
          {config.plans.map((p) => (
            <button key={p.id} onClick={() => pay(p.id)} disabled={!!busy} className="flex items-center justify-between gap-4 p-4 rounded-2xl border border-gray-200 hover:border-[#F26522] text-left transition-colors cursor-pointer disabled:opacity-60">
              <div>
                <p className="font-medium text-gray-900">{p.title}</p>
                {p.badge && <p className="text-[12px] text-[#F26522] mt-0.5">{p.badge}</p>}
              </div>
              <div className="flex items-center gap-2">
                <span className="font-heading text-xl font-semibold text-gray-900">{p.priceRub.toLocaleString('ru-RU')} ₽</span>
                {busy === p.id && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
              </div>
            </button>
          ))}
        </div>

        {error && <p className="text-[13px] text-red-600 mt-3">{error}</p>}
        <p className="text-[12px] text-gray-400 mt-4">
          {config.payment === 'yookassa' ? 'Оплата проходит на стороне ЮKassa. После оплаты вы вернётесь в кабинет.' : 'Тестовый режим: подписка выдаётся без реальной оплаты.'}
        </p>
      </div>
    </div>
  );
}
