import { useEffect, useState, type ComponentType } from 'react';
import { Download, ExternalLink, Lock, Star } from 'lucide-react';
import { api } from './api';
import { safeHref } from './gis/lib';
import type { MapsRow, SearchView, TgRow } from './types';

interface Props {
  result: SearchView;
  subscribed: boolean;
  onSubscribe: () => void;
}

const num = (n: number) => n.toLocaleString('ru-RU');

function Stat({ label, value, hint, accent }: { label: string; value: string; hint: string; accent?: boolean }) {
  return (
    <div className={`p-4 sm:p-5 rounded-2xl ${accent ? 'bg-[rgba(255,178,124,0.09)] border border-[rgba(255,178,124,0.22)]' : 'ember-card-2'}`}>
      <p className={`text-[12px] font-medium mb-1 ${accent ? 'text-[#ffb27c]' : 'text-[#a08c7c]'}`}>{label}</p>
      <p className={`font-heading text-2xl sm:text-3xl font-semibold ${accent ? 'text-[#ffb27c]' : 'text-[#fbf3ea]'}`}>{value}</p>
      <span className="text-[11px] text-[#a08c7c]">{hint}</span>
    </div>
  );
}

function MapsItem({ r, blurred }: { r: MapsRow; blurred?: boolean }) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 rounded-2xl border border-[rgba(255,178,124,0.12)]">
      <div className="min-w-0">
        <p className="font-semibold text-[#fbf3ea] text-[15px] flex items-center gap-2 flex-wrap">
          <span className={blurred ? 'blur-[3px] select-none' : ''}>{r.name}</span>
          {r.rating != null && (
            <span className="text-[12px] text-[#ffb27c] font-medium bg-[rgba(255,178,124,0.1)] px-2 py-0.5 rounded inline-flex items-center gap-1">
              <Star className="w-3 h-3 fill-current" /> {r.rating} ({r.reviews})
            </span>
          )}
        </p>
        <p className={`text-[13px] text-[#a08c7c] mt-1 ${blurred ? 'blur-[3px] select-none' : ''}`}>{r.address}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className={`text-[13px] font-mono text-[#d9c4b5] ${blurred ? 'blur-[3px] select-none' : ''}`}>{r.phone ?? 'телефон не указан'}</span>
        {safeHref(r.url) && !blurred && (
          <a href={safeHref(r.url)} target="_blank" rel="noreferrer" className="text-[#a08c7c] hover:text-[#fbf3ea]" aria-label="Открыть в 2ГИС">
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </div>
    </div>
  );
}

function TgItem({ r, blurred }: { r: TgRow; blurred?: boolean }) {
  return (
    <div className="p-4 rounded-2xl border border-[rgba(255,178,124,0.12)]">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="font-semibold text-[#fbf3ea] text-[15px]">
          <span className={blurred ? 'blur-[3px] select-none' : ''}>{r.name}</span>{' '}
          <span className={`text-[#a08c7c] font-normal ${blurred ? 'blur-[3px] select-none' : ''}`}>@{r.username}</span>
        </p>
        <span className="text-[12px] text-[#a08c7c]">{new Date(r.date).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <p className={`text-[14px] text-[#d9c4b5] mt-2 ${blurred ? 'blur-[3px] select-none' : ''}`}>{r.text}</p>
      <div className="flex items-center justify-between mt-2 text-[12px] text-[#a08c7c]">
        <span className={blurred ? 'blur-[3px] select-none' : ''}>{r.chat}</span>
        {safeHref(r.link) && !blurred && (
          <a href={safeHref(r.link)} target="_blank" rel="noreferrer" className="text-[#F26522] hover:underline inline-flex items-center gap-1">
            Написать <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}

export default function ResultPanel({ result, subscribed, onSubscribe }: Props) {
  const [rows, setRows] = useState<(MapsRow | TgRow)[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isMaps = result.kind === 'maps';
  const revealTrial = !subscribed && Boolean(result.trialRows?.length);

  const load = async (offset: number) => {
    setLoading(true);
    setError('');
    try {
      const r = await api.rows<MapsRow | TgRow>(result.id, offset);
      setRows((prev) => (offset === 0 ? r.rows : [...prev, ...r.rows]));
      setTotal(r.total);
    } catch (e: any) {
      setError(e.message || 'Не удалось загрузить данные');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setRows(result.trialRows ?? []);
    setTotal(result.trialRows?.length ?? 0);
    if (subscribed) load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.id, subscribed, result.trialRows]);

  const s = result.stats;
  const Item = (isMaps ? MapsItem : TgItem) as ComponentType<{ r: any; blurred?: boolean }>;

  return (
    <div className="mt-8">
      {result.demo && (
        <p className="mb-4 text-[12px] text-[#ffb27c] bg-[rgba(255,178,124,0.08)] border border-[rgba(255,178,124,0.18)] rounded-xl px-3.5 py-2">
          Старт-режим: не все бизнесы на бесплатном тарифе будут без сайта
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {isMaps ? (
          <>
            <Stat label="Всего в 2ГИС по нише" value={num(s.total)} hint="точек на карте" />
            <Stat label="Без сайта" value={`${num(s.withoutSite)} (${Math.round((s.withoutSite / Math.max(1, s.total)) * 100)}%)`} hint="потенциальные клиенты" accent />
            <Stat label="С телефоном" value={num(s.withPhone)} hint="можно звонить сразу" />
          </>
        ) : (
          <>
            <Stat label="Нашлось людей" value={num(s.people)} hint={`за ${result.query.days} дн.`} accent />
            <Stat label="В чатах" value={num(s.chats)} hint="публичные сообщества" />
          </>
        )}
      </div>

      <div className="mt-6">
        {subscribed || revealTrial ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-heading text-lg font-medium text-[#fbf3ea]">Данные ({num(total)})</h3>
              {subscribed && (
                <a href={`/api/search/${result.id}/export.csv`} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#F26522] hover:text-[#ffb27c]">
                  <Download className="w-4 h-4" /> Скачать CSV
                </a>
              )}
            </div>
            <div className="space-y-3">{rows.map((r) => <Item key={r.id} r={r} />)}</div>
            {error && <p className="text-[13px] text-[#ff8a5b] mt-3">{error}</p>}
            {rows.length < total && (
              <button onClick={() => load(rows.length)} disabled={loading} className="mt-4 px-5 py-2 rounded-full border border-[rgba(255,178,124,0.2)] text-[#d9c4b5] hover:text-[#fbf3ea] text-[13px] font-medium hover:bg-[rgba(255,178,124,0.08)] transition-colors cursor-pointer disabled:opacity-50">
                {loading ? 'Загружаем…' : 'Показать ещё'}
              </button>
            )}
          </>
        ) : (
          <div className="relative">
            <div className="space-y-3" aria-hidden="true">
              {result.teaser.map((r) => <Item key={r.id} r={r} blurred />)}
            </div>
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-[#100c0a]/20 via-[#100c0a]/90 to-[#100c0a]">
              <div className="text-center px-4">
                <Lock className="w-5 h-5 mx-auto text-[#ffb27c] mb-2" />
                <p className="font-heading text-lg font-medium text-[#fbf3ea]">
                  {isMaps ? `Контакты ${num(s.withoutSite)} компаний скрыты` : `Контакты ${num(s.people)} людей скрыты`}
                </p>
                <p className="text-[13px] text-[#a08c7c] mb-4">Оформите подписку, чтобы увидеть данные и скачать CSV</p>
                <button onClick={onSubscribe} className="px-6 py-2.5 rounded-full bg-[#F26522] hover:bg-[#e05a1a] text-white text-[14px] font-medium transition-colors cursor-pointer">
                  Открыть данные
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
