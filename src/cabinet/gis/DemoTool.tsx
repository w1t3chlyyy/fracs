import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, History as HistoryIcon, Link2, Lock, Map, Play, Search, Square, X } from 'lucide-react';
import { gisApi } from './api';
import { api } from '../api';
import LinkGenerator from './LinkGenerator';
import RecordCard, { bizId, type Mark } from './RecordCard';
import ResultPanel from '../ResultPanel';
import SettingsSections from './SettingsSections';
import { makePool, parseSearchUrl, passes } from './demo';
import { DEFAULT_SETTINGS, type Filters, type GeneratorData, type GisRecord, type Settings } from './types';
import { useLang, usePersisted } from './lib';
import { Section, btnGhost, btnOrange, inputCls } from './ui';
import type { SearchView } from '../types';

interface Props {
  subscribed: boolean;
  admin: boolean;
  /** Подписчику — в раздел «Подписка и программа», остальным — на оплату. */
  onGetProgram: () => void;
  onSubscribe: () => void;
}

const DEMO_MAX = 60;
const TOTAL_MS = 60000;

const sorters: Record<string, (a: GisRecord, b: GisRecord) => number> = {
  name_asc: (a, b) => a.name.localeCompare(b.name, 'ru'),
  name_desc: (a, b) => b.name.localeCompare(a.name, 'ru'),
  rating_desc: (a, b) => (b.rating ?? -1) - (a.rating ?? -1),
  rating_asc: (a, b) => (a.rating ?? -1) - (b.rating ?? -1),
  reviews_desc: (a, b) => (b.review_count ?? -1) - (a.review_count ?? -1),
  reviews_asc: (a, b) => (a.review_count ?? -1) - (b.review_count ?? -1),
};

const PILL: Record<string, [string, string]> = {
  idle: ['bg-gray-100 text-gray-500', 'st_ready'],
  running: ['bg-orange-50 text-[#F26522]', 'st_running'],
  done: ['bg-emerald-50 text-emerald-700', 'st_done'],
  stopped: ['bg-amber-50 text-amber-700', 'st_stopped'],
};

/** Экран «Парсинг 2ГИС»: левая панель настроек + правая зона результатов (Figma-редизайн).
 *  Движок демо-парсера переиспользован из прежней версии; разметка приведена к макету. */
export default function DemoTool({ subscribed, admin, onGetProgram, onSubscribe }: Props) {
  const { t } = useLang();
  const [urls, setUrls] = usePersisted('gis_urls', '');
  const [linkMeta, setLinkMeta] = usePersisted<Record<string, string>>('gis_linkmeta', {});
  const [stored, setSettings] = usePersisted<Settings>('gis_settings', DEFAULT_SETTINGS);
  const settings: Settings = { ...DEFAULT_SETTINGS, ...stored, filters: { ...DEFAULT_SETTINGS.filters, ...stored.filters }, advanced: { ...DEFAULT_SETTINGS.advanced, ...stored.advanced } };
  const [marks, setMarks] = usePersisted<Record<string, Mark>>('gis_marks', {});
  const [sort, setSort] = useState('default');
  const [term, setTerm] = useState('');
  const [urlsInvalid, setUrlsInvalid] = useState(false);

  const [data, setData] = useState<GeneratorData | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [records, setRecords] = useState<GisRecord[]>([]);
  const [scanned, setScanned] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Figma: правая зона — переключатель источника + 4 чекбокса.
  const [source, setSource] = useState<'yandex' | 'owners'>('yandex');
  const [removeWithSite, setRemoveWithSite] = useState(false);
  const [removeYandexNotFound, setRemoveYandexNotFound] = useState(false);
  const [searchOwners, setSearchOwners] = useState(false);

  // История серверных распаковок (trial) — аккордеон слева.
  const [history, setHistory] = useState<SearchView[]>([]);
  const [openedSearch, setOpenedSearch] = useState<SearchView | null>(null);

  const blurDemo = !subscribed || admin;

  useEffect(() => { gisApi.generator().then(setData).catch(() => {}); }, []);
  useEffect(() => { api.history('maps').then((r) => setHistory(r.items)).catch(() => {}); }, []);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const setF = (p: Partial<Filters>) => setSettings({ ...settings, filters: { ...settings.filters, ...p } });

  const finish = (s: 'done' | 'stopped', msg: string) => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setStatus(s);
    setLogs((l) => [...l, msg]);
  };

  const start = () => {
    const lines = urls.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!lines.length) { setUrlsInvalid(true); return; }
    const url = lines[0];
    const { city, query } = parseSearchUrl(url, data?.cities ?? []);
    setRecords([]); setScanned(0); setTerm('');

    const total = Math.min(Math.max(1, settings.max_records), DEMO_MAX);
    const pool = makePool(url, total, city, query);
    const filters = settings.filters;
    const step = Math.max(35, Math.round(TOTAL_MS / total));

    setLogs(['Демо-режим: данные сгенерированы, к 2ГИС запросов нет.', `Парсинг ссылки ${url}`]);
    setStatus('running');

    let i = 0;
    timer.current = setInterval(() => {
      const rec = pool[i];
      i++;
      setScanned(i);
      if (passes(rec, filters)) {
        setRecords((r) => [...r, rec]);
        setLogs((l) => [...l, `Парсинг [${i}] > ${'•'.repeat(8)}`].slice(-300));
      }
      if (i >= pool.length) finish('done', 'Демо завершено. В программе то же самое работает с реальными данными 2ГИС — оформите подписку.');
    }, step);
  };

  const stop = () => finish('stopped', 'Остановлено.');
  const clear = () => { setRecords([]); setScanned(0); setLogs([]); setStatus('idle'); setTerm(''); };

  const setMark = (r: GisRecord, patch: Mark) => {
    const id = bizId(r);
    setMarks({ ...marks, [id]: { ...marks[id], ...patch } });
  };

  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    let arr = q ? records.filter((r) => `${r.name} ${r.address ?? ''} ${r.contacts.phone ?? ''}`.toLowerCase().includes(q)) : records;
    if (sorters[sort]) arr = [...arr].sort(sorters[sort]);
    return arr;
  }, [records, term, sort]);

  const running = status === 'running';
  const locked = blurDemo && records.length > 0;
  const [pillCls, pillKey] = PILL[status] ?? PILL.idle;

  const exportCsv = () => {
    if (!shown.length || locked) return;
    const head = ['Название', 'Рубрики', 'Адрес', 'Телефон', 'WhatsApp', 'Сайт', 'Рейтинг', 'Отзывы'];
    const rows = shown.map((r) => [r.name, r.rubrics.join('; '), r.address ?? '', r.contacts.phone ?? '', r.contacts.whatsapp ?? '', r.contacts.website ?? '', r.rating ?? '', r.review_count ?? '']);
    const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [head, ...rows].map((r) => r.map(esc).join(';')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'fracs-2gis.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* Заголовок экрана */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#F26522] text-white text-[13px] font-medium">
          <Map className="w-4 h-4" /> Парсинг 2ГИС
        </span>
        {subscribed && (
          <button onClick={onGetProgram} className="text-[13px] text-[#ffb27c] hover:text-[#fbf3ea] underline underline-offset-4 cursor-pointer">
            Программа для ПК и ключ →
          </button>
        )}
      </div>

      {/* Демо-баннер */}
      <div className="mb-4 ember-card-2 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] leading-snug text-[#d9c4b5]">
          {blurDemo ? (
            <><b>Демо-режим.</b> Запуск показывает вымышленные бизнесы с блюром. Реальные данные — по подписке.</>
          ) : (
            <><b>Демо-режим.</b> Данные сгенерированы в браузере. Реальный парсинг 2ГИС выполняет программа Fracs Parser на вашем ПК.</>
          )}
        </p>
        <button onClick={onGetProgram} className={`${btnOrange} !px-4 !py-2 !text-[13px]`}>
          {subscribed ? 'Скачать программу' : 'Получить программу'}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* Левая панель — настройки */}
        <aside className="ember-card rounded-3xl p-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-[#a08c7c]">{t('urls_label')}</span>
            <textarea
              id="gis-urls" value={urls} rows={4}
              onChange={(e) => { setUrls(e.target.value); setUrlsInvalid(false); }}
              placeholder={'https://2gis.kz/almaty/search/кафе\nhttps://2gis.ru/moscow/search/Аптеки'}
              className={`${inputCls} min-h-[92px] resize-y leading-snug ${urlsInvalid ? '!border-[#ff8a5b]' : ''}`}
            />
            <span className={`text-[12px] leading-snug ${urlsInvalid ? 'font-semibold text-[#ff8a5b]' : 'text-[#a08c7c]'}`}>
              {urlsInvalid ? t('a_need_url') : t('urls_hint')}
            </span>
          </label>

          <Section title={t('gen_title')} icon={<Link2 className="w-4 h-4" />}>
            <LinkGenerator t={t} urls={urls} setUrls={(v) => { setUrls(v); setUrlsInvalid(false); }} linkMeta={linkMeta} setLinkMeta={setLinkMeta} />
          </Section>

          <SettingsSections t={t} s={settings} setS={setSettings} maxRecords={DEMO_MAX} />

          <Section title={t('hist_title')} icon={<HistoryIcon className="w-4 h-4" />}>
            {history.length ? (
              <div className="flex flex-col gap-1">
                {history.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setOpenedSearch(s)}
                    className="text-left rounded-lg px-2.5 py-2 text-[12.5px] hover:bg-[rgba(255,178,124,0.08)] cursor-pointer"
                  >
                    <span className="font-medium text-[#fbf3ea]">{s.query.niche ?? '—'}</span>
                    <span className="text-[#a08c7c]"> · {s.query.cityLabel?.split(',')[0] ?? ''}</span>
                    <span className="text-[#a08c7c]"> · {s.rowsTotal} зап.</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[12.5px] text-[#a08c7c]">{t('hist_empty')}</p>
            )}
          </Section>

          <div className="flex gap-2.5 pt-1">
            {running ? (
              <button type="button" onClick={stop} className="flex-1 inline-flex items-center justify-center gap-2 rounded-full border border-[rgba(255,138,91,0.3)] text-[#ff8a5b] px-6 py-2.5 text-[14px] font-medium hover:bg-[rgba(255,138,91,0.08)] cursor-pointer">
                <Square className="w-4 h-4" /> {t('stop')}
              </button>
            ) : (
              <button type="button" onClick={start} className={`${btnOrange} flex-1`}>
                <Play className="w-4 h-4" /> {t('run')}
              </button>
            )}
          </div>
        </aside>

        {/* Правая панель — результаты */}
        <div className="min-w-0 ember-card rounded-3xl p-4 flex flex-col gap-3">
          {openedSearch ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <button onClick={() => setOpenedSearch(null)} className="text-[13px] text-[#a08c7c] hover:text-[#fbf3ea] cursor-pointer">← К парсингу</button>
                <span className="text-[12px] text-[#a08c7c]">{openedSearch.query.niche ?? ''} · {openedSearch.rowsTotal} зап.</span>
              </div>
              <ResultPanel result={openedSearch} subscribed={subscribed} onSubscribe={onSubscribe} />
            </>
          ) : (
            <>
              {/* Тулбар */}
              <div className="flex flex-wrap items-center gap-2.5">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold ${pillCls}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current" /> {t(pillKey)}
                </span>
                {status !== 'idle' && (
                  <span className="text-[13px] tabular-nums text-[#a08c7c]">
                    {records.length} {running ? t('collected') : t('found')} · просмотрено {scanned}
                  </span>
                )}
                <div className="relative min-w-[160px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-[#a08c7c]" />
                  <input value={term} onChange={(e) => setTerm(e.target.value)} disabled={locked} placeholder={t('search_ph')} className={`${inputCls} !pl-9 disabled:opacity-50`} />
                </div>
                <select value={sort} onChange={(e) => setSort(e.target.value)} disabled={locked} title={t('sort_title')} className={`${inputCls} !w-auto disabled:opacity-50`}>
                  {['default', 'name_asc', 'name_desc', 'rating_desc', 'rating_asc', 'reviews_desc', 'reviews_asc'].map((k) => (
                    <option key={k} value={k}>{t('sort_' + k)}</option>
                  ))}
                </select>
                <button type="button" onClick={clear} disabled={running || status === 'idle'} className={`${btnGhost} disabled:opacity-50`}>
                  <X className="w-3.5 h-3.5" /> {t('clear')}
                </button>
                <button type="button" onClick={exportCsv} disabled={!shown.length || locked} className="inline-flex items-center gap-1.5 rounded-full bg-[#F26522] hover:bg-[#e05a1a] disabled:opacity-50 px-4 py-2 text-[13px] font-medium text-white transition-colors cursor-pointer">
                  <Download className="w-4 h-4" /> Экспорт
                </button>
              </div>

              {/* Источник + 4 чекбокса */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-[rgba(255,255,255,0.02)] border border-[rgba(255,178,124,0.1)] px-3 py-2.5">
                <div className="inline-flex rounded-full bg-[rgba(0,0,0,0.25)] p-0.5">
                  <button type="button" onClick={() => setSource('yandex')} className={`px-3 py-1 rounded-full text-[12px] font-medium cursor-pointer ${source === 'yandex' ? 'bg-[#F26522] text-white' : 'text-[#a08c7c] hover:text-[#fbf3ea]'}`}>{t('ya_btn')}</button>
                  <button type="button" onClick={() => setSource('owners')} className={`px-3 py-1 rounded-full text-[12px] font-medium cursor-pointer ${source === 'owners' ? 'bg-[#F26522] text-white' : 'text-[#a08c7c] hover:text-[#fbf3ea]'}`}>Владельцы</button>
                </div>
                <label className="flex items-center gap-2 text-[12.5px] text-[#d9c4b5] cursor-pointer">
                  <input type="checkbox" checked={settings.filters.require_no_website} onChange={(e) => setF({ require_no_website: e.target.checked, require_website: e.target.checked ? false : settings.filters.require_website })} className="accent-[#F26522]" /> {t('f_nosite')}
                </label>
                <label className="flex items-center gap-2 text-[12.5px] text-[#d9c4b5] cursor-pointer">
                  <input type="checkbox" checked={removeWithSite} onChange={(e) => setRemoveWithSite(e.target.checked)} className="accent-[#F26522]" /> {t('ya_remove')}
                </label>
                <label className="flex items-center gap-2 text-[12.5px] text-[#d9c4b5] cursor-pointer">
                  <input type="checkbox" checked={removeYandexNotFound} onChange={(e) => setRemoveYandexNotFound(e.target.checked)} className="accent-[#F26522]" /> {t('ya_remove_nf')}
                </label>
                <label className="flex items-center gap-2 text-[12.5px] text-[#d9c4b5] cursor-pointer">
                  <input type="checkbox" checked={searchOwners} onChange={(e) => setSearchOwners(e.target.checked)} className="accent-[#F26522]" /> Искать владельцев после парсинга
                </label>
              </div>

              {/* Журнал парсинга */}
              {logs.length > 0 && (
                <details open={running} className="rounded-2xl border border-[rgba(255,178,124,0.12)] bg-[rgba(255,255,255,0.02)]">
                  <summary className="cursor-pointer select-none list-none px-4 py-3 text-[13px] font-semibold text-[#d9c4b5] [&::-webkit-details-marker]:hidden">{t('log_title')}</summary>
                  <pre ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }} className="m-0 max-h-52 overflow-auto whitespace-pre-wrap break-words border-t border-[rgba(255,178,124,0.1)] bg-[rgba(0,0,0,0.3)] px-4 py-3 font-mono text-[12px] leading-relaxed text-[#d9c4b5]">{logs.join('\n')}</pre>
                </details>
              )}

              {/* Результаты / empty-state */}
              <div>
                {shown.length > 0 ? (
                  <div className="relative">
                    <div className={`grid gap-3 sm:grid-cols-2 xl:grid-cols-3 ${locked ? 'pointer-events-none select-none' : ''}`} aria-hidden={locked}>
                      {shown.map((r, i) => (
                        <RecordCard key={`${bizId(r)}-${i}`} r={r} t={t} demo blurred={locked} mark={marks[bizId(r)]} onMark={(p) => setMark(r, p)} waUrl={() => ''} />
                      ))}
                    </div>
                    {locked && (
                      <div className="absolute inset-0 flex items-start justify-center bg-gradient-to-b from-[#100c0a]/40 via-[#100c0a]/90 to-[#100c0a] pt-16">
                        <div className="sticky top-24 max-w-sm px-4 text-center">
                          <Lock className="mx-auto mb-2 w-5 h-5 text-[#ffb27c]" />
                          <p className="font-heading text-lg font-medium text-[#fbf3ea]">Данные скрыты</p>
                          <p className="mb-4 mt-1 text-[13px] text-[#a08c7c]">Чтобы увидеть результаты, оформите подписку и получите программу Fracs Parser.</p>
                          <button onClick={onSubscribe} className={btnOrange}>Оформить подписку</button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-16 text-center text-[15px] leading-relaxed text-[#a08c7c]">
                    <Search className="w-8 h-8 text-[#a08c7c] mx-auto mb-3" />
                    {running ? t('collecting') : status === 'idle' ? t('empty_start') : t('empty_notfound')}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
