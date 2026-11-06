import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, CheckCircle2, MapPin, Menu, X, Send, Search, Download, Lock } from 'lucide-react';
import { Shader, Swirl, ChromaFlow, FlutedGlass, FilmGrain } from 'shaders/react';

const IMG = {
  maps: 'https://images.unsplash.com/photo-1524661135-423995f22d0b?auto=format&fit=crop&w=1200&q=80',
  tg: 'https://images.unsplash.com/photo-1611746872915-64382b5c76da?auto=format&fit=crop&w=1200&q=80',
  work: 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=1400&q=80',
  shop: 'https://images.unsplash.com/photo-1556740738-b6a63e27c4df?auto=format&fit=crop&w=1200&q=80',
};

function Photo({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  const [ok, setOk] = useState(true);
  return ok ? <img src={src} alt={alt} loading="lazy" onError={() => setOk(false)} className={`w-full h-full object-cover ${className}`} /> : <div className="w-full h-full bg-gray-200" />;
}

const Cta = ({ children, dark = false, href = '/app' }: { children: React.ReactNode; dark?: boolean; href?: string }) => (
  <a href={href} className={`group inline-flex items-center gap-3 rounded-full pl-6 pr-2 py-2 text-[14px] font-medium transition-colors ${dark ? 'bg-gray-900 hover:bg-black text-white' : 'bg-[#F26522] hover:bg-[#e05a1a] text-white'}`}>
    {children}
    <span className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform duration-300 group-hover:-rotate-45 ${dark ? 'bg-white text-gray-900' : 'bg-white text-[#F26522]'}`}><ArrowRight className="w-4 h-4" /></span>
  </a>
);

const Heading = ({ children, sub }: { children: React.ReactNode; sub?: string }) => (
  <div className="mb-10 max-w-3xl">
    <h2 className="font-heading text-[clamp(1.75rem,4.5vw,3.2rem)] font-medium leading-[1.1] tracking-[-0.03em]">{children}</h2>
    {sub && <p className="text-[15px] sm:text-[17px] text-gray-600 mt-4 leading-relaxed">{sub}</p>}
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
    <div className="bg-white rounded-3xl p-5 sm:p-8 border border-gray-200/80">
      <div className="inline-flex bg-[#F2F2F2] rounded-full p-1 mb-6">
        {tabs.map(([id, label, Icon]) => (
          <button key={id} onClick={() => setMode(id)} className={`inline-flex items-center gap-2 px-4 sm:px-5 py-2 rounded-full text-[13px] sm:text-[14px] font-medium transition-colors ${mode === id ? 'bg-gray-900 text-white' : 'text-gray-600'}`}><Icon className="w-4 h-4" />{label}</button>
        ))}
      </div>
      {mode === 'maps' ? (
        <div className="grid lg:grid-cols-2 gap-8">
          <div>
            <p className="text-[13px] font-medium text-gray-500 mb-2">Чем занимаются компании</p>
            <div className="flex flex-wrap gap-2 mb-6">
              {NICHES.map((n) => <button key={n} onClick={() => setNiche(n)} className={`px-3.5 py-1.5 rounded-full text-[13px] transition-colors ${niche === n ? 'bg-[#F26522] text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>{n}</button>)}
            </div>
            <p className="text-[13px] font-medium text-gray-500 mb-2">Город</p>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-gray-400" />
              <input value={q} onChange={(e) => { setQ(e.target.value); setCity(null); }} placeholder="Начните вводить: Казань, rfpfym…" className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-gray-200 text-[14px] focus:outline-none focus:border-[#F26522]" />
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {cities.slice(0, 6).map((c) => <button key={c.id} onClick={() => { setCity(c.name); setQ(c.name); }} className={`px-3 py-1 rounded-full text-[12px] ${city === c.name ? 'bg-gray-900 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>{c.name} <span className="opacity-50">{c.region}</span></button>)}
            </div>
          </div>
          <div className="rounded-2xl bg-[#F7F7F7] p-6 flex flex-col justify-between gap-6">
            <div>
              <p className="text-[13px] text-gray-500">Ваш запрос</p>
              <p className="font-heading text-2xl font-medium mt-1">{niche}{city ? `, ${city}` : ''}</p>
              <p className="text-[14px] text-gray-600 mt-3 leading-relaxed">Мы пройдём по карточкам 2ГИС и оставим компании, у которых не указан сайт. Количество и контакты покажет кабинет — цифры берутся из реального поиска.</p>
            </div>
            <Cta>Запустить поиск</Cta>
          </div>
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-8">
          <div>
            <p className="text-[13px] font-medium text-gray-500 mb-2">Что пишут ваши клиенты</p>
            <input value={phrase} onChange={(e) => setPhrase(e.target.value)} maxLength={120} className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-[14px] focus:outline-none focus:border-[#F26522]" />
            <div className="flex flex-wrap gap-2 mt-3">{PHRASES.map((p) => <button key={p} onClick={() => setPhrase(p)} className="px-3 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-[12px] text-gray-700">{p}</button>)}</div>
          </div>
          <div className="rounded-2xl bg-[#F7F7F7] p-6 flex flex-col justify-between gap-6">
            <div>
              <p className="text-[13px] text-gray-500">Ваш запрос</p>
              <p className="font-heading text-2xl font-medium mt-1">«{phrase || '…'}»</p>
              <p className="text-[14px] text-gray-600 mt-3 leading-relaxed">Найдём свежие сообщения в публичных чатах за 1–3 дня: автор, чат, текст и ссылка, чтобы написать человеку.</p>
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
      <div className="flex justify-between text-[14px] mb-1"><label className="font-medium">{label}</label><span className="font-heading font-semibold">{val}</span></div>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => set(Number(e.target.value))} className="w-full accent-[#F26522]" />
    </div>
  );
  return (
    <div className="grid lg:grid-cols-[1.3fr_1fr] gap-6 bg-white rounded-3xl p-5 sm:p-8 border border-gray-200/80">
      <div className="space-y-6">
        {row('Контактов в работе за месяц', String(contacts), 20, 1000, 10, contacts, setContacts)}
        {row('Отвечают на сообщение', reply + '%', 1, 30, 1, reply, setReply)}
        {row('Из ответивших покупают', close + '%', 5, 60, 1, close, setClose)}
        {row('Средний чек', fmt(check) + ' ₽', 5000, 500000, 5000, check, setCheck)}
      </div>
      <div className="rounded-2xl bg-gray-900 text-white p-6 flex flex-col justify-between gap-6">
        <div>
          <p className="text-[13px] text-gray-400">При таких допущениях вы получите</p>
          <p className="font-heading text-4xl font-medium mt-2">{deals < 1 ? '< 1' : fmt(deals)} {deals >= 1 && deals < 5 ? 'сделки' : 'сделок'}</p>
          <p className="text-gray-300 mt-2">на {fmt(deals * check)} ₽ в месяц</p>
          <p className="text-[12px] text-gray-500 mt-4">Это арифметика на ваших цифрах, а не прогноз сервиса: подставьте свою конверсию.</p>
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
  const [plans, setPlans] = useState<{ id: string; title: string; days: number; priceRub: number; badge?: string }[]>([]);
  useEffect(() => { fetch('/api/config').then((r) => r.json()).then((j) => setPlans(j.plans || [])).catch(() => {}); }, []);

  const links = [['Как это работает', '#start'], ['Расчёт', '#calc'], ['Тарифы', '#pricing'], ['Вопросы', '#faq']];
  return (
    <div className="min-h-screen bg-[#EFEFEF] text-gray-900 font-sans antialiased selection:bg-[#F26522] selection:text-white">
      <section className="relative min-h-screen flex flex-col justify-between overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <Shader className="w-full h-full" disableTelemetry>
            <Swirl colorA="#ffffff" colorB="#f0f0f0" detail={1.7} />
            <ChromaFlow baseColor="#ffffff" downColor="#ff5f03" leftColor="#ff5f03" rightColor="#ff5f03" upColor="#ff5f03" momentum={13} radius={3.5} />
            <FlutedGlass aberration={0.61} angle={31} frequency={8} highlight={0.12} highlightSoftness={0} lightAngle={-90} refraction={4} shape="rounded" softness={1} speed={0.15} />
            <FilmGrain strength={0.05} />
          </Shader>
        </div>
        <header className="relative z-20 w-full max-w-[1440px] mx-auto p-2 sm:p-3">
          <nav className="bg-white rounded-full p-[5px] flex items-center justify-between">
            <div className="flex items-center gap-6">
              <a href="#" className="flex items-center gap-2.5 group">
                <img
                  src="/assets/aistudio/image_a4a02fc4.png"
                  alt="Fracs"
                  className="w-10 h-10 rounded-full object-cover shadow-xs group-hover:scale-105 transition-transform shrink-0"
                />
                <span className="font-heading text-lg font-semibold tracking-tight text-gray-900">Fracs</span>
              </a>
              <div className="hidden md:flex gap-6">{links.map(([l, h]) => <a key={h} href={h} className="text-[14px] font-medium hover:text-gray-500 transition-colors">{l}</a>)}</div>
            </div>
            <div className="hidden md:block pr-1"><a href="/app" className="rounded-full bg-gray-900 hover:bg-black text-white text-[13px] font-medium px-5 py-2.5 transition-colors">Личный кабинет</a></div>
            <button onClick={() => setMenu(!menu)} aria-label="Меню" className="md:hidden w-9 h-9 mr-1 bg-gray-900 text-white rounded-full flex items-center justify-center">{menu ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}</button>
          </nav>
          {menu && (
            <div className="md:hidden mt-2 bg-white rounded-2xl p-5 flex flex-col gap-3">
              {links.map(([l, h]) => <a key={h} href={h} onClick={() => setMenu(false)} className="font-heading text-xl">{l}</a>)}
              <a href="/app" className="font-heading text-xl text-[#F26522]">Личный кабинет</a>
            </div>
          )}
        </header>
        <div className="relative z-20 w-full max-w-[1440px] mx-auto px-5 sm:px-8 lg:px-12 pb-14 lg:pb-20">
          <h1 className="font-heading text-[clamp(2rem,6.5vw,4.6rem)] font-medium leading-[1.05] tracking-[-0.03em] max-w-5xl">Покажем, кому прямо сейчас нужны ваши услуги</h1>
          <p className="mt-5 max-w-xl text-[15px] sm:text-[17px] text-gray-800 leading-relaxed">Компании без сайта на картах 2ГИС и люди, которые сегодня ищут подрядчика в Telegram-чатах. Контакты — в личном кабинете, выгрузка в CSV.</p>
          <div className="mt-8 flex flex-wrap items-center gap-4"><Cta>Попробовать поиск</Cta><a href="#start" className="text-[14px] font-medium underline underline-offset-4">Собрать запрос</a></div>
        </div>
      </section>

      <section id="start" className="bg-[#F5F5F5] py-16 lg:py-24 px-5 sm:px-8 lg:px-12">
        <div className="max-w-[1200px] mx-auto">
          <Heading sub="Выберите, кого искать, — мы покажем, как будет выглядеть запрос. Сам поиск работает в кабинете.">Два источника клиентов в одном кабинете</Heading>
          <QuickStart />
        </div>
      </section>

      <section className="bg-white py-16 lg:py-24 px-5 sm:px-8 lg:px-12">
        <div className="max-w-[1200px] mx-auto grid md:grid-cols-3 gap-5">
          {[
            [IMG.maps, 'Карты 2ГИС', 'Находим компании без указанного сайта: название, адрес, телефон, рейтинг и ссылка на карточку.'],
            [IMG.tg, 'Telegram-чаты', 'Свежие сообщения людей, которые ищут то, что вы продаёте: автор, чат, текст и ссылка для личного сообщения.'],
            [IMG.shop, 'Выгрузка CSV', 'Всё, что нашли, забираете в таблицу и передаёте менеджерам или загружаете в свою CRM.'],
          ].map(([src, t, d]) => (
            <article key={t}>
              <div className="aspect-[4/3] rounded-2xl overflow-hidden bg-gray-100"><Photo src={src} alt={t} className="hover:scale-105 transition-transform duration-700" /></div>
              <h3 className="font-heading text-xl font-semibold mt-4">{t}</h3>
              <p className="text-[14px] text-gray-600 mt-1 leading-relaxed">{d}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="calc" className="bg-[#F5F5F5] py-16 lg:py-24 px-5 sm:px-8 lg:px-12">
        <div className="max-w-[1200px] mx-auto">
          <Heading sub="Двигайте ползунки и подставляйте цифры вашего отдела продаж.">Сколько сделок дадут контакты</Heading>
          <Calculator />
        </div>
      </section>

      <section id="pricing" className="bg-white py-16 lg:py-24 px-5 sm:px-8 lg:px-12">
        <div className="max-w-[1200px] mx-auto">
          <Heading sub="Одна подписка открывает контакты и CSV по всем вашим запросам.">Тарифы</Heading>
          <div className="grid sm:grid-cols-2 gap-5 max-w-3xl">
            {plans.map((p, i) => (
              <div key={p.id} className={`rounded-3xl p-7 flex flex-col justify-between gap-8 ${i === plans.length - 1 ? 'bg-gray-900 text-white' : 'bg-[#F5F5F5]'}`}>
                <div>
                  <p className="font-heading text-2xl font-semibold">{p.title}</p>
                  {p.badge && <p className="text-[13px] text-[#F26522] mt-1">{p.badge}</p>}
                  <p className="font-heading text-4xl font-bold mt-5">{p.priceRub.toLocaleString('ru-RU')} ₽</p>
                  <ul className="mt-5 space-y-2.5 text-[14px]">
                    {[['Контакты компаний и людей', CheckCircle2], ['Выгрузка CSV', Download], ['Вход через Telegram, без паролей', Lock]].map(([t, I]: any) => <li key={t} className="flex items-center gap-2.5"><I className="w-4 h-4 text-[#F26522] shrink-0" />{t}</li>)}
                  </ul>
                </div>
                <Cta>Оформить на {p.days} дн.</Cta>
              </div>
            ))}
            {!plans.length && <p className="text-gray-500 text-[14px]">Тарифы загружаются…</p>}
          </div>
        </div>
      </section>

      <section id="faq" className="bg-[#F5F5F5] py-16 lg:py-24 px-5 sm:px-8 lg:px-12">
        <div className="max-w-[900px] mx-auto">
          <Heading>Частые вопросы</Heading>
          <div className="space-y-3">
            {FAQ.map(([q, a], i) => (
              <div key={q} className="bg-white rounded-2xl overflow-hidden">
                <button onClick={() => setFaq(faq === i ? null : i)} aria-expanded={faq === i} className="w-full p-5 text-left flex justify-between items-center gap-4">
                  <span className="font-heading text-[17px] font-medium">{q}</span>
                  <ChevronDown className={`w-5 h-5 shrink-0 transition-transform ${faq === i ? 'rotate-180 text-[#F26522]' : 'text-gray-400'}`} />
                </button>
                <div className={`grid transition-all duration-300 ${faq === i ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}><div className="overflow-hidden"><p className="px-5 pb-5 text-[14px] text-gray-600 leading-relaxed">{a}</p></div></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-gray-950 text-white py-14 px-5 sm:px-8 lg:px-12">
        <div className="max-w-[1200px] mx-auto flex flex-col sm:flex-row justify-between gap-8">
          <div className="flex items-center gap-3">
            <img
              src="/assets/aistudio/image_a4a02fc4.png"
              alt="Fracs"
              className="w-11 h-11 rounded-full object-cover shrink-0"
            />
            <div>
              <p className="font-heading text-2xl font-semibold leading-none">Fracs</p>
              <p className="text-[13px] text-gray-400 mt-1 max-w-xs">Поиск клиентов в 2ГИС и Telegram.</p>
            </div>
          </div>
          <Cta href="/app">Войти в кабинет</Cta>
        </div>
        <p className="max-w-[1200px] mx-auto mt-10 text-[12px] text-gray-500">© 2026 Fracs</p>
      </footer>
    </div>
  );
}
