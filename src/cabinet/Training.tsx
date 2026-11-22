import { useState } from 'react';
import { GraduationCap, Play, Sparkles } from 'lucide-react';

/** Экран «Обучение» —ember-раздел с поднавигацией Обучение/Стратегии и CTA «Следующий урок».
 *  Контент раздела наполняется позже; сейчас — осмысленное empty-state с водяным знаком. */
export default function Training({ subscribed, onSubscribe }: { subscribed: boolean; onSubscribe: () => void }) {
  const [tab, setTab] = useState<'learn' | 'strategies'>('learn');
  const [notified, setNotified] = useState(false);

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="font-heading text-2xl sm:text-3xl font-medium tracking-[-0.02em] text-[#fbf3ea]">Обучение</h2>
          <div className="inline-flex rounded-full bg-[rgba(255,255,255,0.04)] p-1">
            {([['learn', 'Обучение'], ['strategies', 'Стратегии']] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-colors cursor-pointer ${tab === id ? 'bg-[#F26522] text-white' : 'text-[#d9c4b5] hover:text-[#fbf3ea]'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => (subscribed ? setNotified(true) : onSubscribe())}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#F26522] hover:bg-[#e05a1a] text-white text-[14px] font-medium transition-colors cursor-pointer"
          >
            <Play className="w-4 h-4" /> Следующий урок
          </button>
          {notified && <span className="text-[12px] text-[#ffb27c]">Уроки скоро появятся — пришлём уведомление в Telegram.</span>}
        </div>
      </div>

      <section className="mt-5 ember-card rounded-3xl relative overflow-hidden min-h-[60vh] flex items-center justify-center p-8">
        {/* Водяной знак —大型 типографическая подложка в ember-стиле */}
        <div
          aria-hidden="true"
          className="pointer-events-none select-none absolute inset-0 flex flex-col items-center justify-center text-center"
        >
          <span className="font-serif-h italic font-medium leading-[0.85] tracking-tight text-[rgba(255,178,124,0.06)]" style={{ fontSize: 'clamp(40px, 8vw, 110px)' }}>
            ТЕКСТ
          </span>
          <span className="font-serif-h italic font-medium leading-[0.85] tracking-tight text-[rgba(255,178,124,0.06)]" style={{ fontSize: 'clamp(40px, 8vw, 110px)' }}>
            ОБУЧЕНИЯ
          </span>
        </div>

        {/* Контент поверх водяного знака */}
        <div className="relative z-10 max-w-md text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-2xl bg-[rgba(255,178,124,0.1)] border border-[rgba(255,178,124,0.2)] flex items-center justify-center">
            <GraduationCap className="w-6 h-6 text-[#ffb27c]" />
          </div>
          <h3 className="font-heading text-xl font-medium text-[#fbf3ea]">
            {tab === 'learn' ? 'Уроки скоро появятся' : 'Стратегии скоро появятся'}
          </h3>
          <p className="mt-2 text-[14px] text-[#d9c4b5] leading-relaxed">
            {tab === 'learn'
              ? 'Раздел наполняется: пошаговые видео и инструкции по поиску клиентов на картах 2ГИС и в Telegram, настройке парсера и обработке выгрузок.'
              : 'Готовые сценарии поиска по нишам: от автосервисов до бухгалтерии — какие фильтры ставить, куда ходить в Яндекс Картах, как писать первым.'}
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full ember-chip px-3 py-1.5 text-[12px] text-[#d9c4b5]">
            <Sparkles className="w-3.5 h-3.5 text-[#ffb27c]" /> Первый модуль — «Настройка парсера 2ГИС»
          </div>
        </div>
      </section>
    </div>
  );
}
