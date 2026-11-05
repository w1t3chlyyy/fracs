import { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { api } from './api';
import CityInput from './CityInput';
import History from './History';
import ResultPanel from './ResultPanel';
import type { CityItem, SearchView } from './types';

const SUGGESTIONS = ['Автосервисы и детейлинг', 'Стоматологии и клиники', 'Мебельные производства', 'Юридические компании'];

export default function MapsTool({ subscribed, onSubscribe, onSearched }: { subscribed: boolean; onSubscribe: () => void; onSearched: () => void }) {
  const [niche, setNiche] = useState('');
  const [city, setCity] = useState<CityItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SearchView | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (niche.trim().length < 2) return setError('Укажите нишу — например, «автосервис».');
    if (!city) return setError('Выберите город из списка подсказок.');
    setLoading(true);
    try {
      setResult(await api.searchMaps(niche.trim(), city.id));
      onSearched();
    } catch (err: any) {
      setError(err.message || 'Что-то пошло не так');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2 className="font-heading text-2xl sm:text-3xl font-medium tracking-[-0.02em] text-gray-900">Бизнесы без сайта на картах 2ГИС</h2>
      <p className="text-[14px] text-gray-600 mt-2 max-w-2xl">Укажите нишу и город — найдём компании, у которых в карточке нет рабочего сайта.</p>

      <form onSubmit={submit} className="mt-6 grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-start">
        <div>
          <input
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            maxLength={80}
            placeholder="Ниша: автосервис, стоматология…"
            className="w-full px-3.5 py-2.5 text-[14px] rounded-xl border border-gray-200 bg-white focus:outline-none focus:border-[#F26522] transition-colors"
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {SUGGESTIONS.map((s) => (
              <button type="button" key={s} onClick={() => setNiche(s)} className="px-2.5 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-[12px] text-gray-600 transition-colors cursor-pointer">
                {s}
              </button>
            ))}
          </div>
        </div>
        <CityInput selected={city} onSelect={setCity} />
        <button type="submit" disabled={loading} className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-full bg-[#F26522] hover:bg-[#e05a1a] disabled:opacity-60 text-white text-[14px] font-medium transition-colors cursor-pointer">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
          {loading ? 'Ищем…' : 'Найти бизнесы'}
        </button>
      </form>
      {error && <p className="text-[13px] text-red-600 mt-3">{error}</p>}

      {result && <ResultPanel result={result} subscribed={subscribed} onSubscribe={onSubscribe} />}
      <History kind="maps" refreshKey={result?.id ?? ''} onOpen={setResult} />
    </div>
  );
}
