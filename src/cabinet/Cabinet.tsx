import { useCallback, useEffect, useState } from 'react';
import { Bot, BookOpen, Loader2, LogOut, Map, Send, Wallet } from 'lucide-react';
import { api } from './api';
import AppPanel from './gis/AppPanel';
import DemoTool from './gis/DemoTool';
import PlansModal from './PlansModal';
import TgTool from './TgTool';
import Training from './Training';
import AiAgent from './AiAgent';
import type { AppConfig, Me } from './types';

type Section = 'maps' | 'tg' | 'learn' | 'agent' | 'sub';

const RAIL: { id: Section; label: string; Icon: typeof Map }[] = [
  { id: 'maps', label: 'Парсинг 2ГИС', Icon: Map },
  { id: 'tg', label: 'Telegram', Icon: Send },
  { id: 'learn', label: 'Обучение', Icon: BookOpen },
  { id: 'agent', label: 'AI-Агент', Icon: Bot },
  { id: 'sub', label: 'Подписка и программа', Icon: Wallet },
];

function LoginCard({ config, onDone }: { config: AppConfig; onDone: () => void }) {
  const [link, setLink] = useState<{ token: string; url: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!link) return;
    let stopped = false;
    const t = setInterval(async () => {
      try {
        const r = await api.authStatus(link.token);
        if (stopped) return;
        if (r.status === 'ok') onDone();
        if (r.status === 'expired') {
          setLink(null);
          setError('Ссылка устарела. Попробуйте ещё раз.');
        }
      } catch {
        /* повторим на следующем тике */
      }
    }, 1500);
    return () => { stopped = true; clearInterval(t); };
  }, [link, onDone]);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.authStart();
      setLink(r);
      window.open(r.url, '_blank', 'noopener');
    } catch (e: any) {
      setError(e.message || 'Не удалось начать вход');
    } finally {
      setBusy(false);
    }
  };

  const dev = async () => { await api.devLogin(); onDone(); };

  return (
    <div className="max-w-md mx-auto ember-card rounded-3xl p-8 text-center">
      <img
        src="/assets/aistudio/image_a4a02fc4.png"
        alt="Fracs"
        className="w-14 h-14 rounded-2xl mx-auto mb-4 object-cover shadow-sm"
      />
      <h1 className="font-heading text-3xl font-medium tracking-[-0.02em] text-[#fbf3ea]">Личный кабинет</h1>
      <p className="text-[14px] text-[#d9c4b5] mt-2">Войдите через Telegram-бота — пароль и email не нужны.</p>

      {link ? (
        <div className="mt-6">
          <a href={link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#F26522] hover:bg-[#e05a1a] text-white text-[14px] font-medium transition-colors">
            <Send className="w-4 h-4" /> Открыть бота
          </a>
          <p className="text-[13px] text-[#a08c7c] mt-4 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Нажмите «Start» в Telegram — вход произойдёт сам
          </p>
        </div>
      ) : (
        <button onClick={start} disabled={busy} className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#F26522] hover:bg-[#e05a1a] disabled:opacity-60 text-white text-[14px] font-medium transition-colors cursor-pointer">
          <Send className="w-4 h-4" /> Войти через Telegram
        </button>
      )}

      {error && <p className="text-[13px] text-[#ff8a5b] mt-4">{error}</p>}
      {config.devLogin && (
        <button onClick={dev} type="button" className="mt-4 block mx-auto text-[13px] text-[#a08c7c] hover:text-[#fbf3ea] underline underline-offset-4 cursor-pointer">
          Войти без бота (dev-режим)
        </button>
      )}
      <p className="mt-6 pt-4 border-t border-[rgba(255,178,124,0.1)] text-[12px] text-[#a08c7c] leading-relaxed">
        Входя в кабинет, вы принимаете{' '}
        <a href="/terms" className="text-[#d9c4b5] hover:text-[#fbf3ea] underline underline-offset-2">пользовательское соглашение</a>{' '}
        и{' '}
        <a href="/privacy" className="text-[#d9c4b5] hover:text-[#fbf3ea] underline underline-offset-2">политику конфиденциальности</a>.
      </p>
    </div>
  );
}

function ChannelsRequired({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="max-w-md mx-auto ember-card rounded-3xl p-8 text-center">
      <img src="/assets/aistudio/image_a4a02fc4.png" alt="Fracs" className="w-14 h-14 rounded-2xl mx-auto mb-4 object-cover shadow-sm" />
      <h1 className="font-heading text-2xl font-medium text-[#fbf3ea]">Подпишитесь на каналы</h1>
      <p className="text-[14px] text-[#d9c4b5] mt-2">Доступ к кабинету открыт только при подписке на обязательные каналы Fracs. Откройте бота, подпишитесь на все каналы и вернитесь сюда.</p>
      <button onClick={onRetry} className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#F26522] hover:bg-[#e05a1a] text-white text-[14px] font-medium transition-colors">Проверить подписки</button>
    </div>
  );
}

/** Раздел «Подписка и программа»: статус + тарифы + (подписчикам) ключ и скачивание. */
function SubSection({ subscribed, until, config, onPlans }: { subscribed: boolean; until: string | null; config: AppConfig; onPlans: () => void }) {
  return (
    <div className="max-w-3xl mx-auto">
      <h2 className="font-heading text-2xl font-medium tracking-[-0.02em] text-[#fbf3ea]">Подписка и программа</h2>
      <p className="mt-2 text-[14px] text-[#d9c4b5] max-w-2xl">Управляйте подпиской, ключом лицензии и скачиванием программы Fracs Parser для Windows, macOS и Linux.</p>

      <div className="mt-6 ember-card rounded-2xl p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium text-[#a08c7c]">Статус подписки</p>
          <p className="font-heading text-lg font-semibold text-[#fbf3ea]">
            {subscribed ? `Активна до ${until ? new Date(until).toLocaleDateString('ru-RU') : '—'}` : 'Неактивна'}
          </p>
        </div>
        <button onClick={onPlans} className="px-5 py-2.5 rounded-full bg-[#F26522] hover:bg-[#e05a1a] text-white text-[14px] font-medium transition-colors cursor-pointer">
          {subscribed ? 'Продлить / сменить тариф' : 'Оформить подписку'}
        </button>
      </div>

      {subscribed ? (
        <div className="mt-6"><AppPanel /></div>
      ) : (
        <div className="mt-6 ember-card-2 rounded-2xl p-6 text-center">
          <p className="text-[14px] text-[#d9c4b5]">Программа и ключ лицензии открываются после оформления подписки.</p>
          <button onClick={onPlans} className="mt-4 px-6 py-2.5 rounded-full bg-[#F26522] hover:bg-[#e05a1a] text-white text-[14px] font-medium transition-colors cursor-pointer">Оформить подписку</button>
        </div>
      )}

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 text-[12px] text-[#a08c7c]">
        <a href="https://t.me/HelpManage" target="_blank" rel="noreferrer" className="hover:text-[#fbf3ea] underline underline-offset-4">Поддержка: @HelpManage</a>
        <div className="flex flex-wrap items-center gap-4">
          <a href="/privacy" className="hover:text-[#fbf3ea] underline underline-offset-4">Политика</a>
          <a href="/terms" className="hover:text-[#fbf3ea] underline underline-offset-4">Соглашение</a>
          <a href="/offer" className="hover:text-[#fbf3ea] underline underline-offset-4">Оферта</a>
        </div>
      </footer>
    </div>
  );
}

export default function Cabinet() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [section, setSection] = useState<Section>('maps');
  const [lang, setLang] = useState<'ru' | 'en'>('ru');
  const [plansOpen, setPlansOpen] = useState(false);
  const [paidBanner, setPaidBanner] = useState(false);

  const refresh = useCallback(async () => {
    const m = await api.me();
    setMe(m);
    return m;
  }, []);

  useEffect(() => {
    api.config().then(setConfig).catch(() => {});
    refresh().catch(() => setMe({ user: null }));
  }, [refresh]);

  // Возврат со страницы оплаты: подписка включается вебхуком, поэтому немного опрашиваем.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('paid')) return;
    window.history.replaceState({}, '', '/app');
    setPaidBanner(true);
    let tries = 0;
    const t = setInterval(async () => {
      tries++;
      const m = await refresh().catch(() => null);
      if (m?.subscription?.active || tries >= 15) {
        clearInterval(t);
        if (m?.subscription?.active) setPaidBanner(false);
      }
    }, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  // Вход по индивидуальной ссылке из бота (/app?token=…): опрашиваем /auth/status.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (!token) return;
    window.history.replaceState({}, '', '/app');
    let stopped = false;
    let tries = 0;
    const t = setInterval(async () => {
      tries++;
      try {
        const r = await api.authStatus(token);
        if (stopped) return;
        if (r.status === 'ok') { clearInterval(t); await refresh(); }
        else if (r.status === 'expired' || tries >= 20) { clearInterval(t); }
      } catch { /* повторим на следующем тике */ }
    }, 1500);
    return () => { stopped = true; clearInterval(t); };
  }, [refresh]);

  if (!config || !me) {
    return <div className="min-h-screen ember-bg flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-[#a08c7c]" /></div>;
  }

  const subscribed = !!me.subscription?.active;
  const logout = async () => { await api.logout(); setMe({ user: null }); };
  const openPlans = () => setPlansOpen(true);
  const goSub = () => setSection('sub');

  // Не вошёл / нет каналов — центральный экран без рейла.
  if (!me.user) {
    return (
      <div className="ember-cabinet min-h-screen ember-bg text-[#fbf3ea] font-sans antialiased flex items-center justify-center px-4 py-10">
        <LoginCard config={config} onDone={refresh} />
        {plansOpen && <PlansModal config={config} onClose={() => setPlansOpen(false)} onActivated={async () => { await refresh(); setPlansOpen(false); }} />}
      </div>
    );
  }
  if (me.channelsRequired) {
    return (
      <div className="ember-cabinet min-h-screen ember-bg text-[#fbf3ea] font-sans antialiased flex items-center justify-center px-4 py-10">
        <ChannelsRequired onRetry={refresh} />
      </div>
    );
  }

  return (
    <div className="ember-cabinet min-h-screen ember-bg text-[#fbf3ea] font-sans antialiased flex">
      {/* Icon rail */}
      <aside className="w-[68px] shrink-0 ember-glass border-r border-[rgba(255,178,124,0.1)] flex flex-col items-center gap-1.5 py-4 sticky top-0 h-screen z-20">
        <a href="/" aria-label="На сайт" className="mb-2 group">
          <img src="/assets/aistudio/image_a4a02fc4.png" alt="Fracs" className="w-10 h-10 rounded-full object-cover shadow-xs group-hover:scale-105 transition-transform" />
        </a>
        <nav className="flex flex-col gap-1.5 flex-1">
          {RAIL.map(({ id, label, Icon }) => {
            const active = section === id;
            return (
              <button
                key={id}
                onClick={() => setSection(id)}
                title={label}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                className={`relative w-11 h-11 rounded-2xl flex items-center justify-center transition-colors cursor-pointer ${active ? 'bg-[#F26522] text-white shadow-[0_10px_24px_-10px_rgba(242,101,34,0.75)]' : 'text-[#a08c7c] hover:text-[#fbf3ea] hover:bg-[rgba(255,178,124,0.08)]'}`}
              >
                <Icon className="w-5 h-5" />
                {active && <span className="absolute -left-4 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-full bg-[#F26522]" />}
              </button>
            );
          })}
        </nav>
        <button onClick={logout} title="Выйти" aria-label="Выйти" className="w-11 h-11 rounded-2xl flex items-center justify-center text-[#a08c7c] hover:text-[#fbf3ea] hover:bg-[rgba(255,178,124,0.08)] cursor-pointer">
          <LogOut className="w-5 h-5" />
        </button>
      </aside>

      {/* Main column */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-10 px-3 sm:px-6 pt-3">
          <div className="ember-glass rounded-full px-3 sm:px-4 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="font-heading text-[15px] font-semibold tracking-tight text-[#fbf3ea] whitespace-nowrap">Fracs Parser</span>
              <span className="hidden sm:inline-flex items-center gap-0.5 rounded-full bg-[rgba(255,255,255,0.05)] p-0.5 text-[11px]">
                <button onClick={() => setLang('ru')} className={`px-2 py-0.5 rounded-full font-semibold uppercase cursor-pointer ${lang === 'ru' ? 'bg-[#F26522] text-white' : 'text-[#a08c7c] hover:text-[#fbf3ea]'}`}>RU</button>
                <button onClick={() => setLang('en')} title="English — скоро" className={`px-2 py-0.5 rounded-full font-semibold uppercase cursor-not-allowed ${lang === 'en' ? 'bg-[#F26522] text-white' : 'text-[#a08c7c] opacity-50'}`}>EN</button>
              </span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 pr-0.5">
              <span className="hidden md:inline text-[13px] text-[#d9c4b5]">{me.user.username ? `@${me.user.username}` : me.user.firstName}</span>
              {subscribed ? (
                <span className="text-[12px] font-medium text-[#ffb27c] bg-[rgba(255,178,124,0.1)] border border-[rgba(255,178,124,0.25)] rounded-full px-3 py-1.5 whitespace-nowrap">
                  до {new Date(me.subscription!.until!).toLocaleDateString('ru-RU')}
                </span>
              ) : (
                <button onClick={openPlans} className="text-[13px] font-medium text-white bg-[#F26522] hover:bg-[#e05a1a] rounded-full px-4 py-2 transition-colors cursor-pointer whitespace-nowrap">Подписка</button>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 min-w-0 px-3 sm:px-6 pb-12 pt-3">
          {paidBanner && (
            <p className="mb-4 text-[13px] text-[#d9c4b5] ember-glass rounded-2xl px-4 py-3 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Ждём подтверждения оплаты…
            </p>
          )}

          {section === 'maps' && (
            <DemoTool
              subscribed={subscribed}
              admin={me.admin ?? false}
              onGetProgram={() => (subscribed ? goSub() : openPlans())}
              onSubscribe={openPlans}
            />
          )}
          {section === 'tg' && (
            <TgTool subscribed={subscribed} trialAvailable={me.trial?.tg ?? false} onSubscribe={openPlans} onSearched={() => refresh()} />
          )}
          {section === 'learn' && <Training subscribed={subscribed} onSubscribe={openPlans} />}
          {section === 'agent' && <AiAgent />}
          {section === 'sub' && (
            <SubSection subscribed={subscribed} until={me.subscription?.until ?? null} config={config} onPlans={openPlans} />
          )}
        </main>
      </div>

      {plansOpen && (
        <PlansModal
          config={config}
          onClose={() => setPlansOpen(false)}
          onActivated={async () => { await refresh(); setPlansOpen(false); }}
        />
      )}
    </div>
  );
}
