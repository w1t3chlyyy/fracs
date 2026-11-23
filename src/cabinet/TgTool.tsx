import { useEffect, useState } from 'react';
import { Download, History, Loader2, Lock, Play, Search, Send, Settings2, SlidersHorizontal, Sparkles, Wand2, X } from 'lucide-react';
import { api } from './api';
import ResultPanel from './ResultPanel';
import { Section, btnGhost, btnOrange, inputCls } from './gis/ui';
import type { SearchView } from './types';

const FRACS_HINT = 'Введите фразу — FracsAI сделает 20 похожих и по ним будет идти парсинг после вашего одобрения.';

/** Клиентский генератор вариаций фразы (FracsAI-эмуляция до серверного эндпоинта). */
function expandPhrase(p: string): string[] {
  const base = p.trim().toLowerCase();
  if (!base) return [];
  const tails = [
    '', ' срочно', ' недорого', ' под ключ', ' цена', ' отзывы', ' недорого срочно',
    ' цена сегодня', ' москва', ' спб', ' недорого москва', ' срочно цена',
    ' под ключ недорого', ' цена отзывы', ' недорого спб', ' срочно москва',
    ' под ключ цена', ' недорого отзывы', ' срочно под ключ', ' цена москва',
  ];
  return tails.slice(0, 20).map((s) => (base + s).trim()).filter((v, i, a) => a.indexOf(v) === i);
}

export default function TgTool({ subscribed, trialAvailable, onSubscribe, onSearched }: {
  subscribed: boolean;
  trialAvailable: boolean;
  onSubscribe: () => void;
  onSearched: () => void;
}) {
  const [phrases, setPhrases] = useState('');
  const [days, setDays] = useState(3);
  const [onlyWithUsername, setOnlyWithUsername] = useState(false);
  const [maxPer, setMaxPer] = useState(50);
  const [dedupe, setDedupe] = useState(true);
  const [stream, setStream] = useState(true);
  const [variations, setVariations] = useState<string[]>([]);
  const [active, setActive] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SearchView | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [history, setHistory] = useState<SearchView[]>([]);
  const locked = !subscribed && !trialAvailable;

  const firstPhrase = phrases.split('\n').map((s) => s.trim()).find(Boolean) ?? '';
  const phrase = active || firstPhrase;

  useEffect(() => {
    api.history('tg').then((r) => setHistory(r.items)).catch(() => {});
  }, [result?.id]);

  const gen = () => {
    const v = expandPhrase(phrase);
    setVariations(v);
    setLogs((l) => [...l, `FracsAI: создано ${v.length} вариантов из «${phrase}».`].slice(-50));
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');
    if (locked) return onSubscribe();
    if (phrase.trim().length < 3) return setError('Опишите, кому и что нужно — например, «нужен сайт».');
    setLoading(true);
    setLogs((l) => [...l, `Запуск поиска: «${phrase.trim()}», период ${days} дн.`].slice(-50));
    try {
      const r = await api.searchTg(phrase.trim(), days);
      setResult(r);
      onSearched();
      setLogs((l) => [...l, `Готово: найдено ${r.stats?.people ?? 0} людей.`].slice(-50));
    } catch (err: any) {
      setError(err.message || 'Что-то пошло не так');
      setLogs((l) => [...l, 'Ошибка: ' + (err.message || 'неизвестно')].slice(-50));
    } finally {
      setLoading(false);
    }
  };

  const clearAll = () => { setResult(null); setLogs([]); setError(''); };
  const exportCsv = () => {
    if (!result || !subscribed) return;
    window.location.href = `/api/search/${result.id}/export.csv`;
  };

  return (
    <div>
      {/* Заголовок экрана */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#F26522] text-white text-[13px] font-medium">
          <Send className="w-4 h-4" /> Telegram
        </span>
        {locked && <span className="text-[12px] text-[#ffffff]">Пробный поиск использован</span>}
      </div>

      {locked && (
        <div className="mb-4 ember-card-2 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-[13px] text-[#cccccc]">
            <Lock className="w-4 h-4 shrink-0 text-[#ffffff]" /> Пробный поиск в Telegram использован. Оформите подписку, чтобы искать дальше.
          </p>
          <button onClick={onSubscribe} className={`${btnOrange} !px-4 !py-2 !text-[13px]`}>Оформить подписку</button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* Левая панель — настройки поиска */}
        <aside className="ember-card rounded-3xl p-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-[#888888]">Фразы</span>
            <textarea
              value={phrases}
              onChange={(e) => { setPhrases(e.target.value); setActive(''); }}
              rows={4}
              placeholder={'нужен сайт\nищу бухгалтера\nдизай'}
              className={`${inputCls} min-h-[92px] resize-y leading-snug`}
            />
            <span className="text-[12px] text-[#888888]">По одной фразе на строку. Можно несколько фраз.</span>
          </label>

          <Section title="Создать фразы" icon={<Wand2 className="w-4 h-4" />}>
            <p className="text-[12px] leading-snug text-[#888888]">
              FracsAI расширит активную фразу до 20 вариаций — выбирайте подходящие и запускайте по ним парсинг.
            </p>
            <button type="button" onClick={gen} disabled={!phrase} className={`${btnGhost} w-full disabled:opacity-50`}>
              <Sparkles className="w-3.5 h-3.5" /> Создать 20 похожих
            </button>
            {variations.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {variations.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setActive(active === v ? '' : v)}
                    className={`px-2.5 py-1 rounded-full text-[12px] cursor-pointer transition-colors ${active === v ? 'bg-[#F26522] text-white' : 'bg-[rgba(255,255,255,0.08)] text-[#cccccc] hover:bg-[rgba(255,255,255,0.14)]'}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            )}
            {active && (
              <p className="text-[12px] text-[#ffffff]">Активна: «{active}»</p>
            )}
          </Section>

          <Section title="Фильтры" icon={<Search className="w-4 h-4" />}>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-[#888888]">Период поиска</span>
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={inputCls}>
                <option value={1}>За 1 день</option>
                <option value={2}>За 2 дня</option>
                <option value={3}>За 3 дня</option>
                <option value={7}>За 7 дней</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-[13px] text-[#cccccc] cursor-pointer mt-1">
              <input type="checkbox" checked={onlyWithUsername} onChange={(e) => setOnlyWithUsername(e.target.checked)} className="accent-[#F26522]" /> Только с @username
            </label>
          </Section>

          <Section title="Параметры" icon={<SlidersHorizontal className="w-4 h-4" />}>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-[#888888]">Макс. сообщений на фразу</span>
              <input type="number" min={10} max={500} step={10} value={maxPer} onChange={(e) => setMaxPer(Number(e.target.value) || 50)} className={inputCls} />
            </label>
          </Section>

          <Section title="Расширенные настройки" icon={<Settings2 className="w-4 h-4" />}>
            <label className="flex items-center gap-2 text-[13px] text-[#cccccc] cursor-pointer">
              <input type="checkbox" checked={dedupe} onChange={(e) => setDedupe(e.target.checked)} className="accent-[#F26522]" /> Удалять дубликаты людей
            </label>
            <label className="flex items-center gap-2 text-[13px] text-[#cccccc] cursor-pointer">
              <input type="checkbox" checked={stream} onChange={(e) => setStream(e.target.checked)} className="accent-[#F26522]" /> Потоковый сбор
            </label>
          </Section>

          <Section title="История парсинга" icon={<History className="w-4 h-4" />}>
            {history.length ? (
              <div className="flex flex-col gap-1">
                {history.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setResult(s)}
                    className="text-left rounded-lg px-2.5 py-2 text-[12.5px] hover:bg-[rgba(255,255,255,0.08)] cursor-pointer"
                  >
                    <span className="font-medium text-[#ffffff]">{s.query.phrase ?? '—'}</span>
                    <span className="text-[#888888]"> · {s.rowsTotal} зап.</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[12.5px] text-[#888888]">Пока пусто. Завершённые поиски сохранятся здесь.</p>
            )}
          </Section>

          <button
            type="button"
            onClick={() => submit()}
            disabled={loading || locked}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#F26522] hover:bg-[#e05a1a] disabled:opacity-60 px-6 py-3 text-[14px] font-medium text-white transition-colors cursor-pointer"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} {loading ? 'Ищем…' : 'Запустить'}
          </button>
        </aside>

        {/* Правая панель — подсказка FracsAI + журнал + результаты */}
        <div className="min-w-0 ember-card rounded-3xl p-4 flex flex-col gap-3">
          {/* Тулбар */}
          <div className="flex flex-wrap items-center gap-2.5">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold ${loading ? 'bg-[rgba(242,101,34,0.15)] text-[#ffffff]' : 'bg-[rgba(255,255,255,0.05)] text-[#888888]'}`}>
              <span className={`w-1.5 h-1.5 rounded-full bg-current ${loading ? 'animate-pulse' : ''}`} /> {loading ? 'Идёт поиск…' : 'Готов'}
            </span>
            {result && <span className="text-[13px] tabular-nums text-[#888888]">{result.stats?.people ?? 0} людей</span>}
            <button type="button" onClick={clearAll} disabled={!result} className={`${btnGhost} ml-auto disabled:opacity-50`}>
              <X className="w-3.5 h-3.5" /> Очистить
            </button>
            <button type="button" onClick={exportCsv} disabled={!result || !subscribed} className="inline-flex items-center gap-1.5 rounded-full bg-[#F26522] hover:bg-[#e05a1a] disabled:opacity-50 px-4 py-2 text-[13px] font-medium text-white transition-colors cursor-pointer">
              <Download className="w-4 h-4" /> Экспорт
            </button>
          </div>

          {/* Подсказка FracsAI */}
          <div className="rounded-2xl bg-[rgba(242,101,34,0.08)] border border-[rgba(242,101,34,0.18)] px-3.5 py-3 flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 text-[#ffffff] mt-0.5 shrink-0" />
            <p className="text-[12.5px] leading-snug text-[#cccccc]">{FRACS_HINT}</p>
          </div>

          {/* Журнал парсинга */}
          {logs.length > 0 && (
            <details className="rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.02)]">
              <summary className="cursor-pointer select-none list-none px-4 py-3 text-[13px] font-semibold text-[#cccccc] [&::-webkit-details-marker]:hidden">Журнал парсинга</summary>
              <pre className="m-0 max-h-52 overflow-auto whitespace-pre-wrap break-words border-t border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.3)] px-4 py-3 font-mono text-[12px] leading-relaxed text-[#cccccc]">{logs.join('\n')}</pre>
            </details>
          )}

          {error && <p className="text-[13px] text-[#F26522]">{error}</p>}

          {/* Результаты / empty-state */}
          <div>
            {result ? (
              <ResultPanel result={result} subscribed={subscribed} onSubscribe={onSubscribe} />
            ) : (
              <div className="py-16 text-center text-[15px] leading-relaxed text-[#888888]">
                <Search className="w-8 h-8 text-[#888888] mx-auto mb-3" />
                Укажите фразы слева и нажмите «Запустить».
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
