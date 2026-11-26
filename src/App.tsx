import React, { useEffect, useState } from 'react';
import { ArrowRight, ArrowLeft, MapPin, Menu, X, Send, Plus, Minus, Check } from 'lucide-react';
import HalftoneFlowHero from './HalftoneFlowHero';

const IMG = {
  maps: '/assets/aistudio/image_27a85a5c.png',
  tg: '/assets/aistudio/image_504e11d1.png',
  shop: '/assets/aistudio/image_5fa4b296.png',
};

/* ───────── базовые элементы ───────── */

const Cta = ({ children, dark = false, href = '/app', external = false }: { children: React.ReactNode; dark?: boolean; href?: string; external?: boolean }) => (
  <a
    href={href}
    {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
    className={`group inline-flex items-center gap-3 rounded-full pl-6 pr-1.5 py-1.5 text-[14px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#F26522] ${dark ? 'bg-white hover:bg-[#f1f1f1] text-black' : 'bg-[#F26522] hover:bg-[#e05a1a] text-white'}`}
  >
    {children}
    <span className={`w-9 h-9 rounded-full flex items-center justify-center transition-transform duration-300 group-hover:-rotate-45 ${dark ? 'bg-black text-white' : 'bg-white text-[#F26522]'}`}>
      <ArrowRight className="w-4 h-4" />
    </span>
  </a>
);

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <p className="flex items-center gap-2.5 text-[12px] sm:text-[13px] font-medium uppercase tracking-[0.16em] text-[#F26522]">
    <span className="w-1.5 h-1.5 rounded-full bg-[#F26522]" />
    {children}
  </p>
);

/** Заголовок секции: первая строка белая, вторая оранжевая; справа — пояснение. */
const SectionHead = ({ eyebrow, line1, line2, aside, children }: { eyebrow: string; line1: string; line2: string; aside?: string; children?: React.ReactNode }) => (
  <div className="mb-10 lg:mb-14 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
    <div>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="font-heading font-medium mt-5 text-[clamp(2.1rem,5vw,3.9rem)] leading-[1.06] tracking-[-0.02em] text-white">
        {line1}
        <br />
        <span className="text-[#F26522]">{line2}</span>
      </h2>
    </div>
    {children ?? (aside && <p className="max-w-[26rem] text-[15px] sm:text-[17px] leading-relaxed text-[#8a8a8a]">{aside}</p>)}
  </div>
);

/* ───────── 1. Источники ───────── */

type Row = { title: string; meta: string; hidden: string };

const SOURCES: { icon: React.ElementType; tag: string; badge: string; title: string; text: string; rows: Row[]; cta: string; dark: boolean }[] = [
  {
    icon: MapPin,
    tag: 'Карты 2ГИС',
    badge: 'без сайта',
    title: 'Компании, которым нужен сайт',
    text: 'Название, адрес, телефон, рейтинг и ссылка на карточку.',
    rows: [
      { title: 'Автосервис «Мотор»', meta: 'Казань · ★ 4.7', hidden: '+7 843 ••• •• ••' },
      { title: 'Стоматология «Дента+»', meta: 'Казань · ★ 4.9', hidden: '+7 843 ••• •• ••' },
      { title: 'Клининг «Чисто»', meta: 'Казань · ★ 4.5', hidden: '+7 987 ••• •• ••' },
    ],
    cta: 'Найти компании',
    dark: false,
  },
  {
    icon: Send,
    tag: 'Telegram-чаты',
    badge: 'за 1–3 дня',
    title: 'Люди, которые ищут вас сейчас',
    text: 'Автор, чат, текст сообщения и ссылка, чтобы написать.',
    rows: [
      { title: '«Нужен сайт для салона, кто делает?»', meta: 'Бизнес Казань · 2 ч назад', hidden: '@user_••••' },
      { title: '«Ищу бухгалтера на ИП, недорого»', meta: 'Предприниматели РТ · 5 ч', hidden: '@user_••••' },
      { title: '«Посоветуйте подрядчика на ремонт»', meta: 'Соседи ЖК · вчера', hidden: '@user_••••' },
    ],
    cta: 'Найти людей',
    dark: true,
  },
];

function Sources() {
  return (
    <section id="sources" className="py-16 lg:py-28 px-5 sm:px-8 lg:px-12">
      <div className="max-w-[1320px] mx-auto">
        <SectionHead eyebrow="Источники" line1="Два источника клиентов" line2="в одном кабинете" aside="Пример выдачи — так результаты выглядят в кабинете до оплаты." />
        <div className="grid gap-5 lg:grid-cols-2">
          {SOURCES.map(({ icon: Icon, tag, badge, title, text, rows, cta, dark }) => (
            <article key={tag} className="fx-card rounded-[32px] lg:rounded-[40px] p-6 sm:p-9 flex flex-col">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#141414] px-4 py-2 text-[14px] text-[#d6d6d6]">
                  <Icon className="w-4 h-4 text-[#F26522]" />
                  {tag}
                </span>
                <span className="rounded-full bg-[#F26522]/12 px-3 py-1 text-[12px] text-[#F26522]">{badge}</span>
              </div>
              <h3 className="font-heading font-medium mt-9 text-[clamp(1.5rem,2.6vw,2.2rem)] leading-tight tracking-[-0.01em] text-white">{title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-[#777]">{text}</p>
              <ul className="mt-8 space-y-3">
                {rows.map((r) => (
                  <li key={r.title} className="flex items-center justify-between gap-4 rounded-[20px] bg-[#151515] px-5 py-4">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold text-white">{r.title}</p>
                      <p className="mt-0.5 text-[13px] text-[#777]">{r.meta}</p>
                    </div>
                    <span aria-hidden="true" className="shrink-0 select-none text-[13px] text-[#9a9a9a] blur-[5px]">{r.hidden}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8 pt-1">
                <Cta dark={dark}>{cta}</Cta>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────── 2. Как это работает ───────── */

const STEPS: { n: string; label: string; img: string | null; lead: string; text: string }[] = [
  { n: '01', label: 'Запрос', img: IMG.maps, lead: 'Опишите, кого ищете.', text: 'Ниша и город для карт или фраза, которую пишут ваши клиенты в Telegram, — подсказки помогут сформулировать.' },
  { n: '02', label: 'Поиск', img: IMG.tg, lead: 'Мы собираем выдачу.', text: 'Проходим по карточкам 2ГИС и публичным Telegram-чатам: оставляем компании без сайта и свежие сообщения людей.' },
  { n: '03', label: 'Результат', img: null, lead: 'Смотрите результат до оплаты.', text: 'Количество найденных и три примера с замаскированными данными. Полные контакты откроются после оплаты.' },
  { n: '04', label: 'Выгрузка', img: IMG.shop, lead: 'Забирайте в работу.', text: 'Контакты — в CSV для таблицы или CRM. Дальше менеджеры пишут тем, кто уже ищет вас.' },
];

function HowItWorks() {
  const [step, setStep] = useState(0);
  const cur = STEPS[step];
  const nav = 'w-12 h-12 sm:w-[54px] sm:h-[54px] rounded-full flex items-center justify-center transition-colors disabled:opacity-35 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F26522]';
  return (
    <section id="how" className="py-16 lg:py-28 px-5 sm:px-8 lg:px-12">
      <div className="max-w-[1320px] mx-auto">
        <SectionHead eyebrow="Как это работает" line1="От запроса до сделки —" line2="четыре шага">
          <div className="flex gap-3">
            <button type="button" aria-label="Предыдущий шаг" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))} className={`${nav} border border-white/12 bg-[#151515] text-white hover:bg-[#1f1f1f]`}>
              <ArrowLeft className="w-4 h-4" />
            </button>
            <button type="button" aria-label="Следующий шаг" disabled={step === STEPS.length - 1} onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} className={`${nav} bg-[#F26522] text-white hover:bg-[#e05a1a]`}>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </SectionHead>

        <div className="flex gap-3 sm:gap-4 h-[320px] sm:h-[420px] lg:h-[500px]">
          {STEPS.map((s, i) => {
            const active = i === step;
            const grad = s.img === null;
            return (
              <button
                key={s.n}
                type="button"
                onClick={() => setStep(i)}
                aria-label={`Шаг ${s.n}: ${s.label}`}
                aria-current={active ? 'step' : undefined}
                style={{ flex: active ? 6.5 : 1 }}
                className={`fx-panel relative min-w-0 overflow-hidden rounded-[28px] lg:rounded-[36px] border text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F26522] ${grad ? 'border-[#F26522]/50 fx-panel-hot' : 'border-white/9 bg-[#111]'}`}
              >
                <span className={`absolute top-4 sm:top-5 z-10 rounded-full px-3 sm:px-4 py-1.5 text-[13px] sm:text-[14px] text-white whitespace-nowrap ${grad ? 'bg-black/35' : 'bg-black'} ${active ? 'left-4 sm:left-5' : 'left-1/2 -translate-x-1/2'}`}>
                  {active ? `${s.n} · ${s.label}` : s.n}
                </span>
                {s.img && (
                  <img
                    src={s.img}
                    alt=""
                    loading="lazy"
                    className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 object-contain pointer-events-none transition-[width,opacity] duration-500 ${active ? 'w-[min(320px,60%)] min-w-[200px]' : 'w-[200px] sm:w-[240px] opacity-90'}`}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end" aria-live="polite">
          <p className="max-w-[44rem] text-[18px] sm:text-[22px] leading-[1.45] text-[#7d7d7d]">
            <span className="text-white font-medium">{cur.lead}</span> {cur.text}
          </p>
          <div>
            <Cta>Попробовать запрос</Cta>
          </div>
        </div>

        <div className="mt-8 flex gap-2.5" role="tablist" aria-label="Шаги">
          {STEPS.map((s, i) => (
            <button key={s.n} type="button" role="tab" aria-selected={i === step} aria-label={`Шаг ${s.n}`} onClick={() => setStep(i)} className="py-2 group">
              <span className={`block h-[3px] rounded-full transition-all duration-500 ${i === step ? 'w-[72px] bg-[#F26522]' : 'w-9 bg-[#2a2a2a] group-hover:bg-[#3a3a3a]'}`} />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────── 3. Цифры ───────── */

const STATS: [string, string][] = [
  ['2', 'источника: 2ГИС и Telegram'],
  ['1–3 дня', 'свежесть сообщений в чатах'],
  ['< 1 мин', 'доступ после оплаты'],
  ['CSV', 'выгрузка в таблицу или CRM'],
];

function Stats() {
  return (
    <section className="px-5 sm:px-8 lg:px-12 py-6 lg:py-10">
      <div className="max-w-[1320px] mx-auto grid grid-cols-2 lg:grid-cols-4 border-y border-white/8">
        {STATS.map(([big, small], i) => (
          <div key={big} className={`py-9 lg:py-12 px-5 sm:px-8 lg:px-10 border-white/8 ${i % 2 === 1 ? 'border-l' : ''} ${i > 1 ? 'border-t lg:border-t-0' : ''} ${i > 0 ? 'lg:border-l' : ''}`}>
            <p className="font-heading font-normal text-[clamp(2rem,4vw,3.4rem)] leading-none text-white whitespace-nowrap">{big}</p>
            <p className="mt-5 lg:mt-8 text-[13px] sm:text-[14px] text-[#7a7a7a]">{small}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────── 4. Расчёт ───────── */

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
function dealsWord(n: number) {
  const a = n % 100, b = n % 10;
  if (a > 10 && a < 15) return 'сделок';
  if (b === 1) return 'сделка';
  if (b >= 2 && b <= 4) return 'сделки';
  return 'сделок';
}

function Slider({ label, value, shown, min, max, step, onChange }: { label: string; value: number; shown: string; min: number; max: number; step: number; onChange: (n: number) => void }) {
  const id = React.useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <label htmlFor={id} className="text-[15px] text-[#cfcfcf]">{label}</label>
        <output htmlFor={id} className="font-heading text-[18px] font-semibold text-white tabular-nums">{shown}</output>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="fx-range" style={{ ['--p' as string]: `${pct}%` }} />
    </div>
  );
}

function Calculator() {
  const [contacts, setContacts] = useState(200);
  const [reply, setReply] = useState(8);
  const [close, setClose] = useState(20);
  const [check, setCheck] = useState(60000);
  const answered = (contacts * reply) / 100;
  const deals = (answered * close) / 100;
  const dealsRound = Math.round(deals);
  return (
    <section id="calc" className="py-16 lg:py-28 px-5 sm:px-8 lg:px-12">
      <div className="max-w-[1320px] mx-auto">
        <SectionHead eyebrow="Расчёт" line1="Сколько сделок" line2="дадут контакты" aside="Подставьте цифры своего отдела продаж — арифметика, а не обещания." />
        <div className="fx-card overflow-hidden rounded-[32px] lg:rounded-[40px] grid lg:grid-cols-[1.35fr_1fr]">
          <div className="p-6 sm:p-10 space-y-9">
            <Slider label="Контактов в работе за месяц" value={contacts} shown={String(contacts)} min={20} max={1000} step={10} onChange={setContacts} />
            <Slider label="Отвечают на сообщение" value={reply} shown={`${reply}%`} min={1} max={30} step={1} onChange={setReply} />
            <Slider label="Из ответивших покупают" value={close} shown={`${close}%`} min={5} max={60} step={1} onChange={setClose} />
            <Slider label="Средний чек" value={check} shown={`${fmt(check)} ₽`} min={5000} max={500000} step={5000} onChange={setCheck} />
          </div>
          <div className="p-6 sm:p-10 border-t lg:border-t-0 lg:border-l border-white/8 bg-[radial-gradient(90%_70%_at_0%_0%,rgba(242,101,34,0.10),transparent_70%)] flex flex-col">
            <p className="text-[14px] text-[#8a8a8a]">В месяц при таких цифрах</p>
            <p className="font-heading font-normal mt-5 text-[clamp(2.6rem,5.4vw,4.4rem)] leading-none tracking-[-0.02em] text-white tabular-nums" aria-live="polite">{fmt(deals * check)} ₽</p>
            <p className="mt-4 text-[20px] text-[#d6d6d6]">{dealsRound < 1 ? 'меньше одной сделки' : `≈ ${dealsRound} ${dealsWord(dealsRound)}`}</p>
            <dl className="mt-8 space-y-3">
              {[['Контакты', fmt(contacts)], ['Ответили', fmt(answered)], ['Купили', fmt(deals)]].map(([k, v], i) => (
                <div key={k} className={`flex items-center justify-between rounded-2xl px-5 py-3.5 text-[15px] ${i === 2 ? 'bg-[#1c1c1c]' : 'bg-[#161616]'}`}>
                  <dt className="text-[#a0a0a0]">{k}</dt>
                  <dd className="font-semibold text-[#e6e6e6] tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-8 lg:mt-auto lg:pt-8">
              <Cta>Проверить на своей нише</Cta>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────── 5. Тарифы ───────── */

type Plan = { id: string; title: string; days: number; priceRub: number; badge?: string; description?: string; features?: string[] };

const NEW_FEATURES: [string, string][] = [
  ['owners', 'Владельцы компаний'],
  ['training', 'Обучение'],
  ['ai_provider', 'AI со своим провайдером'],
  ['fracs_ai', 'Встроенный Fracs AI'],
  ['tg_broadcast', 'Рассылки в Telegram'],
  ['business', 'Бизнес-инструменты'],
];
const LOCKED_LABEL: Record<string, string> = { owners: 'Владельцы компаний', ai_provider: 'AI-агент' };
const PLAN_SUB: Record<string, string> = { start: 'Карты и Telegram', pro: 'Для отдела продаж', ultra: 'Всё включено' };

function planRows(plans: Plan[], i: number): { text: string; on: boolean }[] {
  const feats = plans[i].features ?? [];
  const prev = i > 0 ? plans[i - 1].features ?? [] : [];
  const rows: { text: string; on: boolean }[] = i === 0
    ? [{ text: 'Контакты компаний и людей', on: true }, { text: 'Выгрузка CSV', on: true }]
    : [{ text: `Всё из ${plans[i - 1].title}`, on: true }];
  NEW_FEATURES.forEach(([code, label]) => { if (feats.includes(code) && !prev.includes(code)) rows.push({ text: label, on: true }); });
  if (i === 0) Object.entries(LOCKED_LABEL).forEach(([code, label]) => { if (!feats.includes(code)) rows.push({ text: label, on: false }); });
  return rows;
}

function Pricing() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((j) => { setPlans(j.plans || []); setState('ok'); })
      .catch(() => setState('error'));
  }, []);
  return (
    <section id="pricing" className="py-16 lg:py-28 px-5 sm:px-8 lg:px-12">
      <div className="max-w-[1320px] mx-auto">
        <SectionHead eyebrow="Тарифы" line1="Одна подписка —" line2="все контакты" aside="Цены и состав — те же, что в личном кабинете." />
        <div className="grid gap-5 md:grid-cols-3 items-stretch">
          {plans.map((p, i) => {
            const hot = p.id === 'pro';
            const sub = PLAN_SUB[p.id] ?? p.badge ?? '';
            return (
              <article key={p.id} className={`relative rounded-[32px] lg:rounded-[40px] p-7 sm:p-9 flex flex-col ${hot ? 'fx-card-hot' : 'fx-card'}`}>
                {hot && <span className="absolute top-7 right-7 rounded-full bg-[#F26522]/15 px-3 py-1 text-[12px] text-[#F26522]">Популярный</span>}
                <h3 className="font-heading font-medium text-[26px] text-white">{p.title}</h3>
                {sub && <p className="mt-1.5 text-[14px] text-[#777]">{sub}</p>}
                <p className="mt-10 font-heading font-normal text-white text-[clamp(2.4rem,4.2vw,3.6rem)] leading-none tabular-nums">
                  {p.priceRub.toLocaleString('ru-RU')} ₽
                  <span className="ml-2 text-[15px] text-[#777] font-normal">/ {p.days} дн.</span>
                </p>
                <ul className="mt-9 space-y-4 text-[15px]">
                  {planRows(plans, i).map((r) => (
                    <li key={r.text} className={`flex items-center gap-3 ${r.on ? 'text-[#e6e6e6]' : 'text-[#5f5f5f]'}`}>
                      {r.on ? <Check className="w-4 h-4 shrink-0 text-[#F26522]" aria-hidden="true" /> : <Minus className="w-4 h-4 shrink-0" aria-hidden="true" />}
                      <span>{r.text}{!r.on && <span className="sr-only"> — недоступно в этом тарифе</span>}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-10"><Cta dark={!hot}>Оформить</Cta></div>
              </article>
            );
          })}
          {state === 'loading' && <p className="text-[#777] text-[14px] md:col-span-3">Тарифы загружаются…</p>}
          {state === 'error' && (
            <p className="text-[#999] text-[14px] md:col-span-3">
              Не удалось загрузить тарифы. Актуальные цены — <a href="/app" className="text-[#F26522] underline underline-offset-4">в личном кабинете</a>.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/* ───────── 6. Вопросы ───────── */

const FAQ: [string, string][] = [
  ['Откуда берутся данные?', 'Карточки компаний — из каталога 2ГИС через официальный API. Сообщения людей — из публичных Telegram-чатов. Мы ничего не выдумываем: если источник не отвечает, вы увидите ошибку, а не пустые цифры.'],
  ['Что я увижу без подписки?', 'Количество найденных компаний или людей и три строки с замаскированными данными. Контакты и выгрузка CSV открываются после оплаты.'],
  ['Как быстро открывается доступ после оплаты?', 'Оплата проходит через ЮKassa. Как только платёж подтверждён, подписка включается автоматически, а в Telegram приходит уведомление. Обычно это занимает меньше минуты.'],
  ['Как проверяется, что сайта нет?', 'Мы берём контакты из карточки 2ГИС и отбрасываем компании, у которых указан сайт. Если сайт есть, но не указан в карточке, компания может попасть в выдачу — проверяйте перед звонком.'],
  ['Сколько запросов можно делать?', 'Лимит — несколько десятков запросов в сутки. Повторный запрос с теми же параметрами за 24 часа берётся из истории и лимит не тратит.'],
];

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="py-16 lg:py-28 px-5 sm:px-8 lg:px-12">
      <div className="max-w-[1320px] mx-auto grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
        <div>
          <Eyebrow>Вопросы</Eyebrow>
          <h2 className="font-heading font-medium mt-5 text-[clamp(2.1rem,5vw,3.9rem)] leading-[1.06] tracking-[-0.02em] text-white">
            Частые
            <br />
            <span className="text-[#F26522]">вопросы</span>
          </h2>
          <p className="mt-6 max-w-[26rem] text-[15px] sm:text-[17px] leading-relaxed text-[#8a8a8a]">Не нашли ответ? Напишите нам в Telegram — отвечаем в течение дня.</p>
          <div className="mt-8">
            <Cta dark href="https://t.me/HelpManage" external>Написать в Telegram</Cta>
          </div>
        </div>
        <div className="border-t border-white/8 lg:border-t-0">
          {FAQ.map(([q, a], i) => {
            const isOpen = open === i;
            return (
              <div key={q} className="border-b border-white/8 first:lg:border-t-0">
                <h3>
                  <button type="button" id={`faq-q-${i}`} aria-expanded={isOpen} aria-controls={`faq-a-${i}`} onClick={() => setOpen(isOpen ? null : i)} className="w-full py-6 sm:py-7 flex items-center justify-between gap-6 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F26522]">
                    <span className="font-heading font-medium text-[18px] sm:text-[22px] text-white">{q}</span>
                    {isOpen ? <Minus className="w-5 h-5 shrink-0 text-[#F26522]" aria-hidden="true" /> : <Plus className="w-5 h-5 shrink-0 text-[#F26522]" aria-hidden="true" />}
                  </button>
                </h3>
                <div id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`} className={`grid transition-[grid-template-rows] duration-300 ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                  <div className="overflow-hidden">
                    <p className="pb-7 max-w-[40rem] text-[15px] sm:text-[17px] leading-relaxed text-[#8a8a8a]">{a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ───────── 7. Финальный призыв и подвал ───────── */

function Closing() {
  return (
    <section className="px-5 sm:px-8 lg:px-12 pt-10 lg:pt-16 pb-10">
      <div className="max-w-[1320px] mx-auto fx-final rounded-[32px] lg:rounded-[40px] p-8 sm:p-12 lg:p-16 grid gap-10 lg:grid-cols-[1.6fr_1fr] lg:items-end">
        <h2 className="font-heading font-medium text-[clamp(2.4rem,5.6vw,4.6rem)] leading-[1.05] tracking-[-0.02em] text-white">
          Клиенты уже ищут&nbsp;вас.
          <br />
          Осталось их найти.
        </h2>
        <div>
          <p className="max-w-[28rem] text-[16px] sm:text-[18px] leading-relaxed text-[#f1d9c9]">Первый поиск — бесплатно: увидите количество и примеры контактов ещё до оплаты.</p>
          <div className="mt-7">
            <Cta dark>Попробовать поиск</Cta>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const link = 'text-[#7a7a7a] hover:text-white transition-colors';
  return (
    <footer className="px-5 sm:px-8 lg:px-12 pb-10">
      <div className="max-w-[1320px] mx-auto border-t border-white/8 pt-8 text-[13px] sm:text-[14px]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-[#7a7a7a]">© 2026 Fracs</p>
          <nav aria-label="Документы" className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a href="/offer" className={link}>Оферта</a>
            <a href="/privacy" className={link}>Конфиденциальность</a>
            <a href="/terms" className={link}>Условия</a>
            <a href="https://t.me/HelpManage" target="_blank" rel="noreferrer" className={link}>Telegram</a>
          </nav>
        </div>
        <p className="mt-5 text-[12px] text-[#555]">Самозанятый Бенаи Тимур Рустамович · ИНН 920159216794</p>
      </div>
    </footer>
  );
}

/* ───────── страница ───────── */

export default function App() {
  const [menu, setMenu] = useState(false);
  const links = [['Источники', '#sources'], ['Как это работает', '#how'], ['Расчёт', '#calc'], ['Тарифы', '#pricing'], ['Вопросы', '#faq']];
  return (
    <div className="fx-bg min-h-screen text-white font-sans antialiased selection:bg-[#F26522] selection:text-white">
      <section className="relative">
        <header className="absolute top-4 sm:top-6 inset-x-0 z-30 w-full max-w-[1440px] mx-auto px-4 sm:px-6">
          <nav className="ember-glass rounded-full p-[4px] flex items-center justify-between">
            <div className="flex items-center gap-5">
              <a href="#" className="flex items-center gap-2 group">
                <img src="/assets/aistudio/image_a4a02fc4.png" alt="Fracs" className="w-8 h-8 rounded-full object-cover ring-1 ring-white/10 group-hover:scale-105 transition-transform shrink-0" />
                <span className="font-heading text-[15px] font-semibold tracking-tight text-white">Fracs</span>
              </a>
              <div className="hidden md:flex gap-5">{links.map(([l, h]) => <a key={h} href={h} className="text-[13px] font-medium text-[#bbb] hover:text-white transition-colors">{l}</a>)}</div>
            </div>
            <div className="hidden md:block pr-1"><a href="/app" className="rounded-full bg-[#F26522] hover:bg-[#e05a1a] text-white text-[12px] font-medium px-4 py-2 transition-colors">Личный кабинет</a></div>
            <button onClick={() => setMenu(!menu)} aria-label="Меню" aria-expanded={menu} className="md:hidden w-8 h-8 mr-1 bg-[#F26522] hover:bg-[#e05a1a] text-white rounded-full flex items-center justify-center transition-colors">{menu ? <X className="w-3.5 h-3.5" /> : <Menu className="w-3.5 h-3.5" />}</button>
          </nav>
          {menu && (
            <div className="ember-glass md:hidden mt-2 rounded-2xl p-5 flex flex-col gap-3">
              {links.map(([l, h]) => <a key={h} href={h} onClick={() => setMenu(false)} className="font-heading text-xl text-white">{l}</a>)}
              <a href="/app" onClick={() => setMenu(false)} className="font-heading text-xl text-white">Личный кабинет</a>
            </div>
          )}
        </header>
        <HalftoneFlowHero
          title={"Мы знаем кому\n*нужны ваши услуги*"}
          description="Компании без сайта на картах 2ГИС и люди, которые сегодня ищут подрядчика в Telegram-чатах. Контакты — в личном кабинете, выгрузка в CSV."
          prompts={['найти клиентов без сайта в Казани…', 'кто ищет подрядчика в Telegram…', 'собрать контакты автосервисов…']}
          ctaLabel="Попробовать поиск"
          onSubmit={() => { window.location.href = '/app'; }}
          proof="Тысячи контактов еженедельно — карты 2ГИС и Telegram"
          avatars={['АП', 'МК', 'ДВ']}
          palette="ember"
          height="100svh"
        />
      </section>

      <Sources />
      <HowItWorks />
      <Stats />
      <Calculator />
      <Pricing />
      <Faq />
      <Closing />
      <Footer />
    </div>
  );
}
