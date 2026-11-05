import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2, LogOut, Map, Send } from 'lucide-react';
import { api } from './api';
import MapsTool from './MapsTool';
import PlansModal from './PlansModal';
import TgTool from './TgTool';
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
    <div className="max-w-md mx-auto bg-white rounded-3xl p-8 shadow-sm border border-gray-200/80 text-center">
      <h1 className="font-heading text-3xl font-medium tracking-[-0.02em] text-gray-900">Личный кабинет</h1>
      <p className="text-[14px] text-gray-600 mt-2">Войдите через Telegram-бота — пароль и email не нужны.</p>

      {link ? (
        <div className="mt-6">
          <a href={link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#F26522] hover:bg-[#e05a1a] text-white text-[14px] font-medium transition-colors">
            <Send className="w-4 h-4" /> Открыть бота
          </a>
          <p className="text-[13px] text-gray-500 mt-4 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Нажмите «Start» в Telegram — вход произойдёт сам
          </p>
        </div>
      ) : (
        <button onClick={start} disabled={busy} className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#F26522] hover:bg-[#e05a1a] disabled:opacity-60 text-white text-[14px] font-medium transition-colors cursor-pointer">
          <Send className="w-4 h-4" /> Войти через Telegram
        </button>
      )}

      {error && <p className="text-[13px] text-red-600 mt-4">{error}</p>}
      {config.devLogin && (
        <button onClick={dev} className="block mx-auto mt-6 text-[12px] text-gray-400 hover:text-gray-700 underline cursor-pointer">
          Войти без бота (только для разработки)
        </button>
      )}
    </div>
  );
}

export default function Cabinet() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<'maps' | 'tg'>('maps');
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

  if (!config || !me) {
    return <div className="min-h-screen bg-[#EFEFEF] flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  const subscribed = !!me.subscription?.active;
  const logout = async () => { await api.logout(); setMe({ user: null }); };

  return (
    <div className="min-h-screen bg-[#EFEFEF] text-gray-900 font-sans antialiased">
      <header className="max-w-[1100px] mx-auto p-2 sm:p-3">
        <nav className="bg-white rounded-full p-[5px] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <a href="/" aria-label="На сайт" className="w-10 h-10 bg-gray-900 rounded-full flex items-center justify-center hover:bg-black transition-colors">
              <span className="text-[11px] font-bold text-white font-heading">FR</span>
            </a>
            <a href="/" className="hidden sm:inline-flex items-center gap-1.5 text-[13px] text-gray-600 hover:text-gray-900"><ArrowLeft className="w-3.5 h-3.5" /> На сайт</a>
          </div>
          {me.user && (
            <div className="flex items-center gap-2 sm:gap-3 pr-1">
              <span className="hidden sm:inline text-[13px] text-gray-600">{me.user.username ? `@${me.user.username}` : me.user.firstName}</span>
              {subscribed ? (
                <span className="text-[12px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-3 py-1.5">
                  Подписка до {new Date(me.subscription!.until!).toLocaleDateString('ru-RU')}
                </span>
              ) : (
                <button onClick={() => setPlansOpen(true)} className="text-[13px] font-medium text-white bg-gray-900 hover:bg-black rounded-full px-4 py-2 transition-colors cursor-pointer">Оформить подписку</button>
              )}
              <button onClick={logout} aria-label="Выйти" className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center cursor-pointer"><LogOut className="w-4 h-4" /></button>
            </div>
          )}
        </nav>
      </header>

      <main className="max-w-[1100px] mx-auto px-3 sm:px-4 pb-16 pt-6">
        {!me.user ? (
          <LoginCard config={config} onDone={refresh} />
        ) : (
          <>
            {paidBanner && <p className="mb-4 text-[13px] text-gray-700 bg-white border border-gray-200 rounded-2xl px-4 py-3 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Ждём подтверждения оплаты…</p>}
            <div className="inline-flex bg-white rounded-full p-1 mb-6">
              {([['maps', 'Карты 2ГИС', Map], ['tg', 'Telegram', Send]] as const).map(([id, label, Icon]) => (
                <button key={id} onClick={() => setTab(id)} className={`inline-flex items-center gap-2 px-5 py-2 rounded-full text-[14px] font-medium transition-colors cursor-pointer ${tab === id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'}`}>
                  <Icon className="w-4 h-4" /> {label}
                </button>
              ))}
            </div>
            <section className="bg-white rounded-3xl p-6 sm:p-8 border border-gray-200/80 shadow-sm">
              {tab === 'maps'
                ? <MapsTool subscribed={subscribed} onSubscribe={() => setPlansOpen(true)} onSearched={() => refresh()} />
                : <TgTool subscribed={subscribed} onSubscribe={() => setPlansOpen(true)} onSearched={() => refresh()} />}
              {me.quota && <p className="text-[12px] text-gray-400 mt-8">Запросов за 24 часа: {me.quota.used} из {me.quota.limit}</p>}
            </section>
          </>
        )}
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
