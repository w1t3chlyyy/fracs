import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, CheckCircle2, MapPin, Menu, X, Send, Search, Download, Lock } from 'lucide-react';
import HalftoneFlowHero from './HalftoneFlowHero';

const IMG = {
  maps: '/assets/aistudio/image_27a85a5c.png',
  tg: '/assets/aistudio/image_504e11d1.png',
  work: 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=1400&q=80',
  shop: '/assets/aistudio/image_5fa4b296.png',
};

function Photo({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  const [ok, setOk] = useState(true);
  const fit = className.includes('object-') ? '' : 'object-cover';
  return ok ? <img src={src} alt={alt} loading="lazy" onError={() => setOk(false)} className={`w-full h-full ${fit} ${className}`} /> : <div className="w-full h-full bg-[#1c1410]" />;
}

const Cta = ({ children, dark = false, href = '/app' }: { children: React.ReactNode; dark?: boolean; href?: string }) => (
  <a href={href} className={`group inline-flex items-center gap-3 rounded-full pl-5 pr-1.5 py-1.5 text-[13px] font-medium transition-colors ${dark ? 'bg-[#fbf3ea] hover:bg-white text-[#100c0a]' : 'bg-[#F26522] hover:bg-[#e05a1a] text-white'}`}>
    {children}
    <span className={`w-7 h-7 rounded-full flex items-center justify-center transition-transform duration-300 group-hover:-rotate-45 ${dark ? 'bg-[#100c0a] text-[#fbf3ea]' : 'bg-white text-[#F26522]'}`}><ArrowRight className="w-3.5 h-3.5" /></span>
  </a>
);

const Heading = ({ children, sub }: { children: React.ReactNode; sub?: string }) => (
  <div className="mb-10 max-w-3xl">
    <h2 className="font-serif-h text-[clamp(1.75rem,4.5vw,3.2rem)] leading-[1.1] tracking-[-0.02em] text-[#fbf3ea]">{children}</h2>
    {sub && <p className="text-[15px] sm:text-[17px] text-[#a89b8e] mt-4 leading-relaxed">{sub}</p>}
  </div>
);

const NICHES = ['Автосервис', 'Стоматология', 'Мебельное производство', 'Юридические услуги', 'Клининг', 'Фитнес-клуб'];
const PHRASES = ['нужен сайт', 'ищу бухгалтера', 'нужна реклама', 'ищу подрядчика на ремонт'];

/** Живая подсказка городов — тот же /api/cities, что и в кабинете. */
function QuickStart() {
  const [mode, setMode] = useState<'maps' | 'tg'>('maps');
  const [niche, setNiche] = useState(NICHES[0]);
  const [phrase, setPhrase] = useState(PHRASES[0]);
  const [q, setQ] = useState('');
  const [cities, setCities] = useState<{ id: string; name: string; region: string }[]>([]);
  const [city, setCity] = useState<string | null>(null);
  const req = useRef(0);

  useEffect(() => {
    const id = ++req.current;
    const t = setTimeout(() => {
      fetch('/api/cities?q=' + encodeURIComponent(q)).then((r) => r.json()).then((j) => id === req.current && setCities(j.items || [])).catch(() => {});
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const tabs = [['maps', 'Компании без сайта', MapPin], ['tg', 'Люди в Telegram', Send]] as const;
  return (
    <div className="ember-card rounded-3xl p-5 sm:p-8">
      <div className="inline-flex ember-chip rounded-full p-1 mb-6">
        {tabs.map(([id, label, Icon]) => (
          <button key={id} onClick={() => setMode(id)} className={`inline-flex items-center gap-2 px-4 sm:px-5 py-2 rounded-full text-[13px] sm:text-[14px] font-medium transition-colors ${mode === id ? 'bg-[#F26522] text-white border-[#F26522]' : 'border-transparent'}`}><Icon className="w-4 h-4" />{label}</button>
        ))}
      </div>
      {mode === 'maps' ? (
        <div className="grid lg:grid-cols-2 gap-8">
          <div>
            <p className="text-[13px] font-medium text-[#8a7d70] mb-2">Чем занимаются компании</p>
            <div className="flex flex-wrap gap-2 mb-6">
              {NICHES.map((n) => <button key={n} onClick={() => setNiche(n)} className={`px-3.5 py-1.5 rounded-full text-[13px] transition-colors ${niche === n ? 'bg-[#F26522] text-white' : 'ember-chip'}`}>{n}</button>)}
            </div>
            <p className="text-[13px] font-medium text-[#8a7d70] mb-2">Город</p>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-[#8a7d70]" />
              <input value={q} onChange={(e) => { setQ(e.target.value); setCity(null); }} placeholder="Начните вводить: Казань, rfpfym…" className="ember-input w-full pl-10 pr-3 py-2.5 rounded-xl text-[14px]" />
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {cities.slice(0, 6).map((c) => <button key={c.id} onClick={() => { setCity(c.name); setQ(c.name); }} className={`px-3 py-1 rounded-full text-[12px] transition-colors ${city === c.name ? 'bg-[#fbf3ea] text-[#100c0a]' : 'ember-chip'}`}>{c.name} <span className="opacity-50">{c.region}</span></button>)}
            </div>
          </div>
          <div className="ember-card-2 rounded-2xl p-6 flex flex-col justify-between gap-6">
            <div>
              <p className="text-[13px] text-[#8a7d70]">Ваш запрос</p>
              <p className="font-serif-h text-2xl mt-1 text-[#fbf3ea]">{niche}{city ? `, ${city}` : ''}</p>
              <p className="text-[14px] text-[#a89b8e] mt-3 leading-relaxed">Мы пройдём по карточкам 2ГИС и оставим компании, у которых не указан сайт. Количество и контакты покажет кабинет — цифры берутся из реального поиска.</p>
            </div>
            <Cta>Запустить поиск</Cta>
          </div>
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-8">
          <div>
            <p className="text-[13px] font-medium text-[#8a7d70] mb-2">Что пишут ваши клиенты</p>
            <input value={phrase} onChange={(e) => setPhrase(e.target.value)} maxLength={120} className="ember-input w-full px-3.5 py-2.5 rounded-xl text-[14px]" />
            <div className="flex flex-wrap gap-2 mt-3">{PHRASES.map((p) => <button key={p} onClick={() => setPhrase(p)} className="ember-chip px-3 py-1 rounded-full text-[12px]">{p}</button>)}</div>
          </div>
          <div className="ember-card-2 rounded-2xl p-6 flex flex-col justify-between gap-6">
            <div>
              <p className="text-[13px] text-[#8a7d70]">Ваш запрос</p>
              <p className="font-serif-h text-2xl mt-1 text-[#fbf3ea]">«{phrase || '…'}»</p>
              <p className="text-[14px] text-[#a89b8e] mt-3 leading-relaxed">Найдём свежие сообщения в публичных чатах за 1–3 дня: автор, чат, текст и ссылка, чтобы написать человеку.</p>
            </div>
            <Cta>Запустить поиск</Cta>
          </div>
        </div>
      )}
    </div>
  );
}

function Calculator() {
  const [contacts, setContacts] = useState(200);
  const [reply, setReply] = useState(8);
  const [close, setClose] = useState(20);
  const [check, setCheck] = useState(60000);
  const deals = (contacts * reply * close) / 10000;
  const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
  const row = (label: string, val: string, min: number, max: number, step: number, v: number, set: (n: number) => void) => (
    <div>
      <div className="flex justify-between text-[14px] mb-1"><label className="text-[#d9c4b5]">{label}</label><span className="font-serif-h text-[#ffb27c]">{val}</span></div>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => set(Number(e.target.value))} className="w-full accent-[#F26522]" />
    </div>
  );
  return (
    <div className="grid lg:grid-cols-[1.3fr_1fr] gap-6 ember-card rounded-3xl p-5 sm:p-8">
      <div className="space-y-6">
        {row('Контактов в работе за месяц', String(contacts), 20, 1000, 10, contacts, setContacts)}
        {row('Отвечают на сообщение', reply + '%', 1, 30, 1, reply, setReply)}
        {row('Из ответивших покупают', close + '%', 5, 60, 1, close, setClose)}
        {row('Средний чек', fmt(check) + ' ₽', 5000, 500000, 5000, check, setCheck)}
      </div>
      <div className="ember-card-2 rounded-2xl p-6 flex flex-col justify-between gap-6">
        <div>
          <p className="text-[13px] text-[#a89b8e]">При таких допущениях вы получите</p>
          <p className="font-serif-h text-4xl mt-2 text-[#ffb27c]">{deals < 1 ? '< 1' : fmt(deals)} {deals >= 1 && deals < 5 ? 'сделки' : 'сделок'}</p>
          <p className="text-[#d9c4b5] mt-2">на {fmt(deals * check)} ₽ в месяц</p>
          <p className="text-[12px] text-[#8a7d70] mt-4">Это арифметика на ваших цифрах, а не прогноз сервиса: подставьте свою конверсию.</p>
        </div>
        <Cta>Проверить на своей нише</Cta>
      </div>
    </div>
  );
}

const FAQ = [
  ['Откуда берутся данные?', 'Карточки компаний — из каталога 2ГИС через официальный API. Сообщения людей — из публичных Telegram-чатов. Мы ничего не выдумываем: если источник не отвечает, вы увидите ошибку, а не пустые цифры.'],
  ['Что я увижу без подписки?', 'Количество найденных компаний или людей и три строки с замаскированными данными. Контакты и выгрузка CSV открываются после оплаты.'],
  ['Как быстро открывается доступ после оплаты?', 'Оплата проходит через ЮKassa. Как только платёж подтверждён, подписка включается автоматически, а в Telegram приходит уведомление. Обычно это занимает меньше минуты.'],
  ['Как проверяется, что сайта нет?', 'Мы берём контакты из карточки 2ГИС и отбрасываем компании, у которых указан сайт. Если сайт есть, но не указан в карточке, компания может попасть в выдачу — проверяйте перед звонком.'],
  ['Сколько запросов можно делать?', 'Лимит — несколько десятков запросов в сутки. Повторный запрос с теми же параметрами за 24 часа берётся из истории и лимит не тратит.'],
];

export default function App() {
  const [menu, setMenu] = useState(false);
  const [faq, setFaq] = useState<number | null>(0);
  const [plans, setPlans] = useState<{ id: string; title: string; days: number; priceRub: number; badge?: string; description?: string }[]>([]);
  useEffect(() => { fetch('/api/config').then((r) => r.json()).then((j) => setPlans(j.plans || [])).catch(() => {}); }, []);

  const links = [['Как это работает', '#start'], ['Расчёт', '#calc'], ['Тарифы', '#pricing'], ['Вопросы', '#faq']];
  return (
    <div className="ember-bg min-h-screen text-[#fbf3ea] font-sans antialiased selection:bg-[#F26522] selection:text-white">
      <section className="relative">
        <header className="absolute top-4 sm:top-6 inset-x-0 z-30 w-full max-w-[1440px] mx-auto px-4 sm:px-6">
          <nav className="ember-glass rounded-full p-[4px] flex items-center justify-between">
            <div className="flex items-center gap-5">
              <a href="#" className="flex items-center gap-2 group">
                <img
                  src="/assets/aistudio/image_a4a02fc4.png"
                  alt="Fracs"
                  className="w-8 h-8 rounded-full object-cover ring-1 ring-white/10 group-hover:scale-105 transition-transform shrink-0"
                />
                <span className="font-heading text-[15px] font-semibold tracking-tight text-[#fbf3ea]">Fracs</span>
              </a>
              <div className="hidden md:flex gap-5">{links.map(([l, h]) => <a key={h} href={h} className="text-[13px] font-medium text-[#c9b9a9] hover:text-[#fbf3ea] transition-colors">{l}</a>)}</div>
            </div>
            <div className="hidden md:block pr-1"><a href="/app" className="rounded-full bg-[#F26522] hover:bg-[#e05a1a] text-white text-[12px] font-medium px-4 py-2 transition-colors">Личный кабинет</a></div>
            <button onClick={() => setMenu(!menu)} aria-label="Меню" className="md:hidden w-8 h-8 mr-1 bg-[#F26522] hover:bg-[#e05a1a] text-white rounded-full flex items-center justify-center transition-colors">{menu ? <X className="w-3.5 h-3.5" /> : <Menu className="w-3.5 h-3.5" />}</button>
          </nav>
          {menu && (
            <div className="ember-glass md:hidden mt-2 rounded-2xl p-5 flex flex-col gap-3">
              {links.map(([l, h]) => <a key={h} href={h} onClick={() => setMenu(false)} className="font-heading text-xl text-[#fbf3ea]">{l}</a>)}
              <a href="/app" onClick={() => setMenu(false)} className="font-heading text-xl text-[#ffb27c]">Личный кабинет</a>
            </div>
          )}
        </header>
        <HalftoneFlowHero
          badge="Поиск клиентов на картах 2ГИС и в Telegram"
          title={"Кому прямо сейчас\n*нужны ваши услуги*"}
          description="Компании без сайта на картах 2ГИС и люди, которые сегодня ищут подрядчика в Telegram-чатах. Контакты — в личном кабинете, выгрузка в CSV."
          prompts={[
            'найти клиентов без сайта в Казани…',
            'кто сегодня ищет подрядчика в Telegram…',
            'собрать контакты автосервисов за город…',
          ]}
          ctaLabel="Попробовать поиск"
          onSubmit={() => { window.location.href = '/app'; }}
          proof="Тысячи контактов еженедельно — карты 2ГИС и Telegram"
          avatars={['АП', 'МК', 'ДВ']}
          palette="ember"
          height="100svh"
        />
      </section>

      <section id="start" className="py-16 lg:py-24 px-5 sm:px-8 lg:px-12">
        <div className="max-w-[1200px] mx-auto">
          <Heading sub="Выберите, кого искать, — мы покажем, как будет выглядеть запрос. Сам поиск работает в кабинете.">Два источника клиентов в одном кабинете</Heading>
          <QuickStart />
        </div>
      </section>

      <section className="py-16 lg:py-24 px-5 sm:px-8 lg:px-12">
        <div className="max-w-[1200px] mx-auto">
          <Heading sub="От запроса до выгрузки — четыре шага, без ручного копания в каталогах и чатах.">Как это работает</Heading>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              [IMG.maps, 'Карты 2ГИС', 'Находим компании без указанного сайта: название, адрес, телефон, рейтинг и ссылка на карточку.'],
              [IMG.tg, 'Telegram-чаты', 'Свежие сообщения людей, которые ищут то, что вы продаёте: автор, чат, текст и ссылка для личного сообщения.'],
              [IMG.shop, 'Выгрузка CSV', 'Всё, что нашли, забираете в таблицу и передаёте менеджерам или загружаете в свою CRM.'],
            ].map(([src, t, d]) => (
              <article key={t} className="ember-card rounded-3xl p-5">
                <div className="aspect-[4/3] rounded-2xl overflow-hidden ember-card-2 mb-4"><Photo src={src} alt={t} className="object-contain p-4 hover:scale-105 transition-transform duration-700" /></div>
                <h3 className="font-serif-h text-xl text-[#fbf3ea]">{t}</h3>
                <p className="text-[14px] text-[#a89b8e] mt-1 leading-relaxed">{d}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="calc" className="py-16 lg:py-24 px-5 sm:px-8 lg:px-12">
        <div className="max-w-[1200px] mx-auto">
          <Heading sub="Двигайте ползунки и подставляйте цифры вашего отдела продаж.">Сколько сделок дадут контакты</Heading>
          <Calculator />
        </div>
      </section>

      <section id="pricing" className="py-16 lg:py-24 px-5 sm:px-8 lg:px-12">
        <div className="max-w-[1200px] mx-auto">
          <Heading sub="Одна подписка открывает контакты и CSV по всем вашим запросам.">Тарифы</Heading>
          <div className="grid gap-5 md:grid-cols-3">
            {plans.map((p, i) => (
              <div key={p.id} className={`rounded-3xl p-6 sm:p-7 flex flex-col justify-between gap-8 ${i === plans.length - 1 ? 'ember-card-2' : 'ember-card'}`}>
                <div>
                  <p className="font-serif-h text-2xl text-[#fbf3ea]">{p.title}</p>
                  {p.badge && <p className="text-[13px] text-[#ffb27c] mt-1">{p.badge}</p>}
                  <p className="font-serif-h text-4xl font-bold mt-5 text-[#ffb27c]">{p.priceRub.toLocaleString('ru-RU')} ₽</p>
                  {p.description && (
                    <p className="text-[13.5px] mt-3 leading-relaxed text-[#a89b8e]">
                      {p.description}
                    </p>
                  )}
                  <ul className="mt-5 space-y-2.5 text-[14px] text-[#d9c4b5]">
                    {[['Контакты компаний и людей', CheckCircle2], ['Выгрузка CSV', Download], ['Вход через Telegram, без паролей', Lock]].map(([t, I]: any) => <li key={t} className="flex items-center gap-2.5"><I className="w-4 h-4 text-[#F26522] shrink-0" />{t}</li>)}
                  </ul>
                </div>
                <Cta dark={i === plans.length - 1}>Оформить на {p.days} дн.</Cta>
              </div>
            ))}
            {!plans.length && <p className="text-[#8a7d70] text-[14px]">Тарифы загружаются…</p>}
          </div>
        </div>
      </section>

      <section id="faq" className="py-16 lg:py-24 px-5 sm:px-8 lg:px-12">
        <div className="max-w-[900px] mx-auto">
          <Heading>Частые вопросы</Heading>
          <div className="space-y-3">
            {FAQ.map(([q, a], i) => (
              <div key={q} className="ember-card rounded-2xl overflow-hidden">
                <button onClick={() => setFaq(faq === i ? null : i)} aria-expanded={faq === i} className="w-full p-5 text-left flex justify-between items-center gap-4">
                  <span className="font-serif-h text-[17px] text-[#fbf3ea]">{q}</span>
                  <ChevronDown className={`w-5 h-5 shrink-0 transition-transform ${faq === i ? 'rotate-180 text-[#ffb27c]' : 'text-[#8a7d70]'}`} />
                </button>
                <div className={`grid transition-all duration-300 ${faq === i ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}><div className="overflow-hidden"><p className="px-5 pb-5 text-[14px] text-[#a89b8e] leading-relaxed">{a}</p></div></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-[#0c0908] border-t border-[rgba(255,178,124,0.08)] py-14 px-5 sm:px-8 lg:px-12">
        <div className="max-w-[1200px] mx-auto flex flex-col sm:flex-row justify-between gap-8">
          <div className="flex items-center gap-3">
            <img
              src="/assets/aistudio/image_a4a02fc4.png"
              alt="Fracs"
              className="w-10 h-10 rounded-full object-cover shrink-0"
            />
            <div>
              <p className="font-serif-h text-2xl leading-none text-[#fbf3ea]">Fracs</p>
              <p className="text-[13px] text-[#8a7d70] mt-1 max-w-xs">Поиск клиентов в 2ГИС и Telegram.</p>
            </div>
          </div>
          <Cta href="/app">Войти в кабинет</Cta>
        </div>
        <div className="max-w-[1200px] mx-auto mt-10 flex flex-wrap items-center justify-between gap-4 text-[12px] text-[#8a7d70]">
          <p>© 2026 Fracs · Самозанятый Бенаи Тимур Рустамович · ИНН: 920159216794</p>
          <div className="flex flex-wrap items-center gap-5">
            <a href="https://t.me/HelpManage" target="_blank" rel="noreferrer" className="hover:text-[#ffb27c] underline underline-offset-4 transition-colors">
              Поддержка: @HelpManage
            </a>
            <a href="/privacy" className="hover:text-[#ffb27c] underline underline-offset-4 transition-colors">Политика конфиденциальности</a>
            <a href="/terms" className="hover:text-[#ffb27c] underline underline-offset-4 transition-colors">Пользовательское соглашение</a>
            <a href="/offer" className="hover:text-[#ffb27c] underline underline-offset-4 transition-colors">Публичная оферта</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
