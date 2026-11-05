import { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { api } from './api';
import History from './History';
import ResultPanel from './ResultPanel';
import type { SearchView } from './types';

const SUGGESTIONS = ['нужен сайт', 'ищу бухгалтера', 'нужна реклама', 'ищу подрядчика на ремонт'];

export default function TgTool({ subscribed, onSubscribe, onSearched }: { subscribed: boolean; onSubscribe: () => void; onSearched: () => void }) {
  const [phrase, setPhrase] = useState('');
  const [days, setDays] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SearchView | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (phrase.trim().length < 3) return setError('Опишите, кому и что нужно — например, «нужен сайт».');
    setLoading(true);
    try {
      setResult(await api.searchTg(phrase.trim(), days));
      onSearched();
    } catch (err: any) {
      setError(err.message || 'Что-то пошло не так');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2 className="font-heading text-2xl sm:text-3xl font-medium tracking-[-0.02em] text-gray-900">Люди в Telegram, которым это нужно</h2>
      <p className="text-[14px] text-gray-600 mt-2 max-w-2xl">Напишите, что ищет ваш клиент, — найдём свежие сообщения в публичных чатах.</p>

      <form onSubmit={submit} className="mt-6 grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 items-start">
        <div>
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            maxLength={120}
            placeholder="Что ищут: «нужен сайт», «ищу бухгалтера»…"
            className="w-full px-3.5 py-2.5 text-[14px] rounded-xl border border-gray-200 bg-white focus:outline-none focus:border-[#F26522] transition-colors"
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {SUGGESTIONS.map((s) => (
              <button type="button" key={s} onClick={() => setPhrase(s)} className="px-2.5 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-[12px] text-gray-600 transition-colors cursor-pointer">
                {s}
              </button>
            ))}
          </div>
        </div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="За какой период" className="px-3.5 py-2.5 text-[14px] rounded-xl border border-gray-200 bg-white focus:outline-none focus:border-[#F26522]">
          <option value={1}>За 1 день</option>
          <option value={2}>За 2 дня</option>
          <option value={3}>За 3 дня</option>
        </select>
        <button type="submit" disabled={loading} className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-full bg-[#F26522] hover:bg-[#e05a1a] disabled:opacity-60 text-white text-[14px] font-medium transition-colors cursor-pointer">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
          {loading ? 'Ищем…' : 'Найти людей'}
        </button>
      </form>
      {error && <p className="text-[13px] text-red-600 mt-3">{error}</p>}

      {result && <ResultPanel result={result} subscribed={subscribed} onSubscribe={onSubscribe} />}
      <History kind="tg" refreshKey={result?.id ?? ''} onOpen={setResult} />
    </div>
  );
}
