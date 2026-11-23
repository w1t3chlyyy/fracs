import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2, LogOut, Map, Send } from 'lucide-react';
import { api } from './api';
import AppPanel from './gis/AppPanel';
import PlansModal from './PlansModal';
import type { AppConfig, Me } from './types';

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
      <h1 className="font-heading text-3xl font-medium tracking-[-0.02em] text-[#ffffff]">Личный кабинет</h1>
      <p className="text-[14px] text-[#cccccc] mt-2">Войдите через Telegram-бота — пароль и email не нужны.</p>

      {link ? (
        <div className="mt-6">
          <a href={link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#F26522] hover:bg-[#e05a1a] text-white text-[14px] font-medium transition-colors">
            <Send className="w-4 h-4" /> Открыть бота
          </a>
          <p className="text-[13px] text-[#888888] mt-4 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Нажмите «Start» в Telegram — вход произойдёт сам
          </p>
        </div>
      ) : (
        <button onClick={start} disabled={busy} className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#F26522] hover:bg-[#e05a1a] disabled:opacity-60 text-white text-[14px] font-medium transition-colors cursor-pointer">
          <Send className="w-4 h-4" /> Войти через Telegram
        </button>
      )}

      {error && <p className="text-[13px] text-[#F26522] mt-4">{error}</p>}
      {config.devLogin && (
        <button onClick={dev} type="button" className="mt-4 block mx-auto text-[13px] text-[#888888] hover:text-[#ffffff] underline underline-offset-4 cursor-pointer">
          Войти без бота (dev-режим)
        </button>
      )}
      <p className="mt-6 pt-4 border-t border-[rgba(255,255,255,0.1)] text-[12px] text-[#888888] leading-relaxed">
        Входя в кабинет, вы принимаете{' '}
        <a href="/terms" className="text-[#cccccc] hover:text-[#ffffff] underline underline-offset-2">пользовательское соглашение</a>{' '}
        и{' '}
        <a href="/privacy" className="text-[#cccccc] hover:text-[#ffffff] underline underline-offset-2">политику конфиденциальности</a>.
      </p>
    </div>
  );
}

function ChannelsRequired({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="max-w-md mx-auto ember-card rounded-3xl p-8 text-center">
      <img src="/assets/aistudio/image_a4a02fc4.png" alt="Fracs" className="w-14 h-14 rounded-2xl mx-auto mb-4 object-cover shadow-sm" />
      <h1 className="font-heading text-2xl font-medium text-[#ffffff]">Подпишитесь на каналы</h1>
      <p className="text-[14px] text-[#cccccc] mt-2">Доступ к кабинету открыт только при подписке на обязательные каналы Fracs. Откройте бота, подпишитесь на все каналы и вернитесь сюда.</p>
      <button onClick={onRetry} className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#F26522] hover:bg-[#e05a1a] text-white text-[14px] font-medium transition-colors cursor-pointer">Проверить подписки</button>
    </div>
  );
}

export default function Cabinet() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [me, setMe] = useState<Me | null>(null);
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
    return (
      <div className="ember-cabinet min-h-screen ember-bg flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#888888]" />
      </div>
    );
  }

  const subscribed = !!me.subscription?.active;
  const logout = async () => { await api.logout(); setMe({ user: null }); };
  const openPlans = () => setPlansOpen(true);

  // Не вошёл — центральный экран входа.
  if (!me.user) {
    return (
      <div className="ember-cabinet min-h-screen ember-bg text-[#ffffff] font-sans antialiased flex items-center justify-center px-4 py-10">
        <LoginCard config={config} onDone={refresh} />
        {plansOpen && <PlansModal config={config} onClose={() => setPlansOpen(false)} onActivated={async () => { await refresh(); setPlansOpen(false); }} />}
      </div>
    );
  }

  // Нет подписки на обязательные каналы — просим подписаться.
  if (me.channelsRequired) {
    return (
      <div className="ember-cabinet min-h-screen ember-bg text-[#ffffff] font-sans antialiased flex items-center justify-center px-4 py-10">
        <ChannelsRequired onRetry={refresh} />
      </div>
    );
  }

  // Залогинен — кабинет: чёрный фон, белый текст, оранжевый акцент.
  return (
    <div className="ember-cabinet min-h-screen ember-bg text-[#ffffff] font-sans antialiased">
      <header className="sticky top-0 z-10 px-3 sm:px-6 pt-3">
        <div className="ember-glass rounded-full px-3 sm:px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img src="/assets/aistudio/image_a4a02fc4.png" alt="Fracs" className="w-9 h-9 rounded-full object-cover shadow-xs" />
            <span className="font-heading text-[15px] font-semibold tracking-tight text-[#ffffff] whitespace-nowrap">Fracs</span>
            <a href="/" className="hidden sm:inline-flex items-center gap-1 text-[13px] text-[#888888] hover:text-[#ffffff] transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" /> На сайт
            </a>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 pr-0.5">
            <span className="hidden md:inline text-[13px] text-[#cccccc]">{me.user.username ? `@${me.user.username}` : me.user.firstName}</span>
            {subscribed ? (
              <span className="text-[12px] font-medium text-[#F26522] bg-[rgba(242,101,34,0.15)] border border-[rgba(242,101,34,0.3)] rounded-full px-3 py-1.5 whitespace-nowrap">
                до {me.subscription?.until ? new Date(me.subscription.until).toLocaleDateString('ru-RU') : '—'}
              </span>
            ) : (
              <button onClick={openPlans} className="text-[13px] font-medium text-white bg-[#F26522] hover:bg-[#e05a1a] rounded-full px-4 py-2 transition-colors cursor-pointer whitespace-nowrap">Подписка</button>
            )}
            <button onClick={logout} title="Выйти" aria-label="Выйти" className="w-9 h-9 rounded-full bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.16)] flex items-center justify-center text-[#888888] hover:text-[#ffffff] transition-colors cursor-pointer">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="px-3 sm:px-6 pb-12 pt-4 max-w-6xl mx-auto">
        {/* Табы-пилюли */}
        <div className="ember-glass rounded-full p-1 inline-flex gap-1 mb-4">
          <button className="px-4 py-2 rounded-full bg-[#F26522] text-white text-[13px] font-medium flex items-center gap-2 cursor-default">
            <Map className="w-4 h-4" /> Карты 2ГИС
          </button>
          <button disabled title="Скоро" className="px-4 py-2 rounded-full text-[#888888] text-[13px] font-medium flex items-center gap-2 cursor-not-allowed">
            <Send className="w-4 h-4" /> Telegram
          </button>
        </div>

        {/* Главная карточка */}
        <div className="ember-card rounded-3xl p-5 sm:p-8">
          {paidBanner && (
            <p className="mb-4 text-[13px] text-[#cccccc] bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-2xl px-4 py-3 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#F26522]" /> Ждём подтверждения оплаты…
            </p>
          )}
          {subscribed ? (
            <AppPanel />
          ) : (
            <div className="text-center py-10">
              <h2 className="font-heading text-2xl font-medium tracking-[-0.02em] text-[#ffffff] sm:text-3xl">Программа Fracs Parser</h2>
              <p className="mt-2 max-w-2xl mx-auto text-[14px] text-[#cccccc]">Программа и ключ лицензии открываются после оформления подписки.</p>
              <button onClick={openPlans} className="mt-5 inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#F26522] hover:bg-[#e05a1a] text-white text-[14px] font-medium transition-colors cursor-pointer">Оформить подписку</button>
            </div>
          )}
        </div>

        <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 text-[12px] text-[#888888] px-1">
          <a href="https://t.me/HelpManage" target="_blank" rel="noreferrer" className="hover:text-[#ffffff] underline underline-offset-4">Поддержка: @HelpManage</a>
          <div className="flex flex-wrap items-center gap-4">
            <a href="/privacy" className="hover:text-[#ffffff] underline underline-offset-4">Политика</a>
            <a href="/terms" className="hover:text-[#ffffff] underline underline-offset-4">Соглашение</a>
            <a href="/offer" className="hover:text-[#ffffff] underline underline-offset-4">Оферта</a>
          </div>
        </footer>
      </main>

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
