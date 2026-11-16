import { useEffect, useMemo, useRef, useState } from 'react';
import { Link2, Lock, Play, Search, Square, X } from 'lucide-react';
import { gisApi } from './api';
import LinkGenerator from './LinkGenerator';
import RecordCard, { bizId, type Mark } from './RecordCard';
import SettingsSections from './SettingsSections';
import { makePool, parseSearchUrl, passes } from './demo';
import { DEFAULT_SETTINGS, type GeneratorData, type GisRecord, type Settings } from './types';
import { useLang, usePersisted } from './lib';
import { Section, btnGhost, btnOrange, inputCls } from './ui';

interface Props {
  subscribed: boolean;
  /** Подписчику ведёт на раздел «Программа», остальным — на оплату */
  onGetProgram: () => void;
}

const DEMO_MAX = 60; // записей, которые демо «просматривает»
const TOTAL_MS = 60000; // сколько длится имитация: 1 минута

const sorters: Record<string, (a: GisRecord, b: GisRecord) => number> = {
  name_asc: (a, b) => a.name.localeCompare(b.name, 'ru'),
  name_desc: (a, b) => b.name.localeCompare(a.name, 'ru'),
  rating_desc: (a, b) => (b.rating ?? -1) - (a.rating ?? -1),
  rating_asc: (a, b) => (a.rating ?? -1) - (b.rating ?? -1),
  reviews_desc: (a, b) => (b.review_count ?? -1) - (a.review_count ?? -1),
  reviews_asc: (a, b) => (a.review_count ?? -1) - (b.review_count ?? -1),
  rubric_asc: (a, b) => a.name.localeCompare(b.name, 'ru'),
};
const PILL = { idle: ['bg-gray-100 text-gray-500', 'st_ready'], running: ['bg-orange-50 text-[#F26522]', 'st_running'], done: ['bg-emerald-50 text-emerald-700', 'st_done'], stopped: ['bg-amber-50 text-amber-700', 'st_stopped'] } as const;

/** Демо парсера: тот же интерфейс, что в программе, но данные сгенерированы в браузере. */
export default function DemoTool({ subscribed, onGetProgram }: Props) {
  const { lang, setLang, t } = useLang();
  const [urls, setUrls] = usePersisted('gis_urls', '');
  const [linkMeta, setLinkMeta] = usePersisted<Record<string, string>>('gis_linkmeta', {});
  const [stored, setSettings] = usePersisted<Settings>('gis_settings', DEFAULT_SETTINGS);
  const settings: Settings = { ...DEFAULT_SETTINGS, ...stored, filters: { ...DEFAULT_SETTINGS.filters, ...stored.filters }, advanced: { ...DEFAULT_SETTINGS.advanced, ...stored.advanced } };
  const [marks, setMarks] = usePersisted<Record<string, Mark>>('gis_marks', {});
  const [cols, setCols] = usePersisted<string>('gis_cols', 'auto');
  const [sort, setSort] = useState('default');
  const [term, setTerm] = useState('');
  const [urlsInvalid, setUrlsInvalid] = useState(false);

  const [data, setData] = useState<GeneratorData | null>(null);
  const [status, setStatus] = useState<keyof typeof PILL>('idle');
  const [records, setRecords] = useState<GisRecord[]>([]);
  const [scanned, setScanned] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { gisApi.generator().then(setData).catch(() => {}); }, []);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

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
    const total = Math.min(Math.max(1, settings.max_records), DEMO_MAX);
    const pool = makePool(url, total, city, query);
    const filters = settings.filters;
    const step = Math.max(35, Math.round(TOTAL_MS / total)); // вся имитация занимает ~1 минуту

    setRecords([]); setScanned(0); setTerm('');
    setLogs(['Демо-режим: данные сгенерированы, к 2ГИС запросов нет.', `Парсинг ссылки ${url}`]);
    setStatus('running');

    let i = 0;
    timer.current = setInterval(() => {
      const rec = pool[i];
      i++;
      setScanned(i);
      if (passes(rec, filters)) {
        setRecords((r) => [...r, rec]);
        // Названия бизнесов в журнале скрыты
        setLogs((l) => [...l, `Парсинг [${i}] > ${'•'.repeat(8)}`].slice(-300));
      }
      if (i >= pool.length) finish('done', 'Демо завершено. Чтобы увидеть результаты, оформите подписку: в программе то же самое работает с реальными данными 2ГИС.');
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

  const [pillCls, pillKey] = PILL[status];
  const running = status === 'running';
  // После парсинга без подписки карточки скрыты блюром
  const locked = !subscribed && records.length > 0;      // карточки размыты всегда
  const showPaywall = locked && !running && status !== 'idle'; // плашка — после окончания
  const gridCls = cols === '1' ? 'grid-cols-1' : cols === '2' ? 'sm:grid-cols-2' : cols === '3' ? 'sm:grid-cols-2 xl:grid-cols-3' : 'sm:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]';

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-medium tracking-[-0.02em] text-gray-900 sm:text-3xl">Демо: бизнесы без сайта на картах 2ГИС</h2>
          <p className="mt-2 max-w-2xl text-[14px] text-gray-600">Соберите ссылки, настройте фильтры и запустите — посмотрите, как выглядит работа программы и результат.</p>
        </div>
        <div className="flex gap-1 rounded-full bg-gray-100 p-1">
          {(['ru', 'kk'] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} className={`cursor-pointer rounded-full px-3 py-1 text-[12px] font-medium uppercase ${lang === l ? 'bg-gray-900 text-white' : 'text-gray-600'}`}>{l === 'kk' ? 'KZ' : l}</button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3">
        <p className="max-w-3xl text-[13px] leading-snug text-gray-700">
          <b>Free Trial.</b> Компании, телефоны и рейтинги отдаются в тестовом варианте. Качественный парсинг 2ГИС выполняет программа Fracs Parser на вашем компьютере — она открывается после оплаты подписки.
        </p>
        <button type="button" onClick={onGetProgram} className={btnOrange}>{subscribed ? 'Скачать программу' : 'Получить программу'}</button>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-3 lg:sticky lg:top-3 lg:max-h-[calc(100vh-1.5rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="gis-urls" className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{t('urls_label')}</label>
            <textarea
              id="gis-urls" value={urls} rows={4}
              onChange={(e) => { setUrls(e.target.value); setUrlsInvalid(false); }}
              placeholder={'https://2gis.ru/moscow/search/Кафе\nhttps://2gis.ru/kazan/search/Аптеки'}
              className={`${inputCls} min-h-[92px] resize-y leading-snug ${urlsInvalid ? '!border-red-500' : ''}`}
            />
            <p className={`text-[12px] leading-snug ${urlsInvalid ? 'font-semibold text-red-600' : 'text-gray-500'}`}>{urlsInvalid ? t('a_need_url') : 'В демо обрабатывается первая ссылка. В программе — любое количество.'}</p>
          </div>

          <Section title={t('gen_title')} icon={<Link2 className="h-4 w-4" />}>
            <LinkGenerator t={t} urls={urls} setUrls={(v) => { setUrls(v); setUrlsInvalid(false); }} linkMeta={linkMeta} setLinkMeta={setLinkMeta} />
          </Section>
          <SettingsSections t={t} s={settings} setS={setSettings} maxRecords={DEMO_MAX} />

          <div className="flex gap-2.5 pt-1">
            {running ? (
              <button type="button" onClick={stop} className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border border-red-200 bg-white px-6 py-2.5 text-[14px] font-medium text-red-600 hover:bg-red-50">
                <Square className="h-4 w-4" /> {t('stop')}
              </button>
            ) : (
              <button type="button" onClick={start} className={`${btnOrange} flex-1`}><Play className="h-4 w-4" /> {t('run')}</button>
            )}
          </div>
        </aside>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold ${pillCls}`}>{t(pillKey)}</span>
            {status !== 'idle' && <span className="text-[13px] tabular-nums text-gray-500">{records.length} {running ? t('collected') : t('found')} · просмотрено {scanned}</span>}
            <div className="relative min-w-[160px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input value={term} onChange={(e) => setTerm(e.target.value)} disabled={locked} placeholder={t('search_ph')} className={`${inputCls} !pl-9 disabled:opacity-50`} />
            </div>
            <select value={sort} onChange={(e) => setSort(e.target.value)} disabled={locked} title={t('sort_title')} className={`${inputCls} !w-auto disabled:opacity-50`}>
              {['default', 'name_asc', 'name_desc', 'rating_desc', 'rating_asc', 'reviews_desc', 'reviews_asc'].map((k) => <option key={k} value={k}>{t(`sort_${k}`)}</option>)}
            </select>
            <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
              {['1', '2', '3'].map((c) => (
                <button key={c} type="button" onClick={() => setCols(cols === c ? 'auto' : c)} className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-[12px] font-semibold ${cols === c ? 'bg-white text-[#F26522] shadow-sm' : 'text-gray-500'}`}>{c}</button>
              ))}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-gray-500">{t('dl_label')}</span>
            {['html', 'csv', 'xlsx', 'json'].map((f) => (
              <button key={f} type="button" onClick={onGetProgram} title="Выгрузка доступна в программе" className="cursor-pointer rounded-lg bg-gray-900 px-3 py-1.5 text-[12px] font-semibold uppercase text-white opacity-40 hover:opacity-60">{f}</button>
            ))}
            <span className="text-[12px] text-gray-400">— в программе</span>
            <button type="button" disabled={running || status === 'idle'} onClick={clear} className={`${btnGhost} ml-auto`}><X className="h-3.5 w-3.5" /> {t('clear')}</button>
          </div>

          {logs.length > 0 && (
            <details open={running} className="mt-4 rounded-2xl border border-gray-200 bg-white">
              <summary className="cursor-pointer select-none list-none px-4 py-3 text-[13px] font-semibold text-gray-700 [&::-webkit-details-marker]:hidden">{t('log_title')}</summary>
              <pre ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }} className="m-0 max-h-52 overflow-auto whitespace-pre-wrap break-words border-t border-gray-100 bg-[#FAFAFA] px-4 py-3 font-mono text-[12px] leading-relaxed text-gray-600">{logs.join('\n')}</pre>
            </details>
          )}

          <div className="mt-4">
            {shown.length > 0 ? (
              <div className="relative">
                <div className={`grid gap-4 ${gridCls} ${locked ? 'pointer-events-none select-none' : ''}`} aria-hidden={locked}>
                  {shown.map((r, i) => (
                    <RecordCard
                      key={`${bizId(r)}-${i}`} r={r} t={t} demo blurred={locked}
                      mark={marks[bizId(r)]} onMark={(p) => setMark(r, p)} waUrl={() => ''}
                    />
                  ))}
                </div>
                {locked && (
                  <div className="absolute inset-0 flex items-start justify-center bg-gradient-to-b from-white/40 via-white/85 to-white pt-16">
                    <div className="sticky top-24 max-w-sm px-4 text-center">
                      <Lock className="mx-auto mb-2 h-5 w-5 text-gray-500" />
                      <p className="font-heading text-lg font-medium text-gray-900">Данные скрыты</p>
                      <p className="mb-4 mt-1 text-[13px] text-gray-600">Чтобы увидеть результаты, купите подписку и получите программу Fracs Parser.</p>
                      <button type="button" onClick={onGetProgram} className={btnOrange}>Купить подписку</button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-16 text-center text-[15px] leading-relaxed text-gray-500">
                <div className="mb-2 text-4xl">{status === 'idle' ? '🔎' : '∅'}</div>
                {running ? t('collecting') : status === 'idle' ? t('empty_start') : t('empty_notfound')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
