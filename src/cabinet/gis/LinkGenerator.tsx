import { useEffect, useMemo, useState } from 'react';
import { gisApi } from './api';
import type { GeneratorData } from './types';
import type { TFn } from './lib';
import { Dropdown, Field, btnDark, inputCls } from './ui';

interface Props {
  t: TFn;
  urls: string;
  setUrls: (v: string) => void;
  linkMeta: Record<string, string>;
  setLinkMeta: (m: Record<string, string>) => void;
}

const tools = 'flex gap-1 px-1 pb-2 text-[11px] text-gray-500';
const link = 'cursor-pointer text-[#F26522] hover:underline';

/** Генератор ссылок 2ГИС: страна → города → районы → запрос/рубрика. */
export default function LinkGenerator({ t, urls, setUrls, linkMeta, setLinkMeta }: Props) {
  const [data, setData] = useState<GeneratorData | null>(null);
  const [failed, setFailed] = useState(false);
  const [country, setCountry] = useState('ru');
  const [cities, setCities] = useState<Set<string>>(new Set()); // `${code}|${domain}`
  const [dists, setDists] = useState<Set<string>>(new Set()); // `${cityCode}\u0000${name}`
  const [custom, setCustom] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState('');
  const [query, setQuery] = useState('');
  const [rub, setRub] = useState<{ c: string; l: string } | null>(null);
  const [rubSearch, setRubSearch] = useState('');
  const [added, setAdded] = useState<number | null>(null);

  useEffect(() => {
    gisApi.generator().then(setData).catch(() => setFailed(true));
  }, []);

  const countryCities = useMemo(() => data?.cities.filter((c) => c.k === country) ?? [], [data, country]);
  const rubrics = useMemo(() => (data?.rubrics ?? []).filter((r) => (country === 'ru' ? r.r : r.n)), [data, country]);
  const selCities = countryCities.filter((c) => cities.has(`${c.c}|${c.d}`));
  const rubList = useMemo(() => {
    const term = rubSearch.trim().toLowerCase();
    return (term ? rubrics.filter((r) => r.l.toLowerCase().includes(term)) : rubrics).slice(0, 300);
  }, [rubrics, rubSearch]);

  const toggle = <T,>(set: Set<T>, v: T, on: boolean) => {
    const n = new Set(set);
    on ? n.add(v) : n.delete(v);
    return n;
  };

  const changeCountry = (c: string) => {
    setCountry(c); setCities(new Set()); setDists(new Set()); setCustom([]); setRub(null); setRubSearch('');
  };

  const toggleCity = (key: string, on: boolean) => {
    if (on && !cities.has(key) && cities.size >= 3) {
      alert('За один запуск можно выбрать не более 3 городов.');
      return;
    }
    setCities(toggle(cities, key, on));
  };

  const add = () => {
    const q = query.trim();
    if (!q) return alert(t('a_need_query'));
    if (!selCities.length) return alert(t('a_need_city'));
    const existing = urls.split('\n').map((s) => s.trim()).filter(Boolean);
    const seen = new Set(existing);
    const meta = { ...linkMeta };
    let n = 0;
    const build = (domain: string, code: string, district: string) => {
      const text = district ? `${q} ${district}` : q;
      const url = `https://2gis.${domain}/${code}/search/${encodeURIComponent(text)}${rub ? `/rubricId/${rub.c}` : ''}/filters/sort=name`;
      if (!seen.has(url)) { existing.push(url); seen.add(url); n++; }
      if (district) meta[url] = district; // район попадёт на отдельный лист XLSX
    };
    for (const c of selCities) {
      const own = (data?.districts[c.c] ?? []).filter((d) => dists.has(`${c.c}\u0000${d}`));
      const all = [...own, ...custom];
      if (!all.length) build(c.d, c.c, '');
      else all.forEach((d) => build(c.d, c.c, d));
    }
    setUrls(existing.join('\n'));
    setLinkMeta(meta);
    setAdded(n);
    setTimeout(() => setAdded(null), 1300);
  };

  if (failed) return <p className="text-[12px] text-red-600">Не удалось загрузить справочники 2ГИС.</p>;
  if (!data) return <p className="text-[12px] text-gray-400">…</p>;

  const distCount = dists.size + custom.length;
  return (
    <>
      <Field label={t('country')}>
        <select value={country} onChange={(e) => changeCountry(e.target.value)} className={inputCls}>
          {data.countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
      </Field>

      <div className="flex flex-col gap-1">
        <span className="text-[12px] text-gray-500">{t('cities')}</span>
        <Dropdown label={cities.size ? t('cities_sel') + selCities.length : t('cities_btn')}>
          {() => (
            <>
              <div className={tools}>
                <a className={link} onClick={() => {
                  setCities(new Set(countryCities.slice(0, 3).map((c) => `${c.c}|${c.d}`)));
                  if (countryCities.length > 3) alert('Выбраны первые 3 города.');
                }}>{t('select_all')}</a>·
                <a className={link} onClick={() => setCities(new Set())}>{t('reset')}</a>
              </div>
              <div className="flex max-h-56 flex-col overflow-auto">
                {countryCities.length ? countryCities.map((c) => (
                  <label key={c.c} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[13px] hover:bg-gray-50">
                    <input type="checkbox" className="accent-[#F26522]" checked={cities.has(`${c.c}|${c.d}`)} onChange={(e) => toggleCity(`${c.c}|${c.d}`, e.target.checked)} />
                    {c.n}
                  </label>
                )) : <div className="text-[12px] text-gray-500">{t('no_cities')}</div>}
              </div>
            </>
          )}
        </Dropdown>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[12px] text-gray-500">{t('district')}</span>
        <Dropdown label={distCount ? t('district_sel') + distCount : t('no_district')}>
          {() => (
            <>
              <div className={tools}>
                <a className={link} onClick={() => setDists(new Set(selCities.flatMap((c) => (data.districts[c.c] ?? []).map((d) => `${c.c}\u0000${d}`))))}>{t('select_all')}</a>·
                <a className={link} onClick={() => { setDists(new Set()); setCustom([]); }}>{t('reset')}</a>
              </div>
              <div className="flex max-h-48 flex-col overflow-auto">
                {!selCities.length && <div className="py-1 text-[12px] text-gray-500">{t('dist_pick_city')}</div>}
                {selCities.map((c) => {
                  const list = data.districts[c.c] ?? [];
                  if (!list.length) return null;
                  return (
                    <div key={c.c}>
                      {selCities.length > 1 && <div className="pt-1.5 text-[10.5px] font-bold uppercase tracking-wide text-gray-400">{c.n}</div>}
                      {list.map((d) => (
                        <label key={d} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[13px] hover:bg-gray-50">
                          <input type="checkbox" className="accent-[#F26522]" checked={dists.has(`${c.c}\u0000${d}`)} onChange={(e) => setDists(toggle(dists, `${c.c}\u0000${d}`, e.target.checked))} />
                          {d}
                        </label>
                      ))}
                    </div>
                  );
                })}
                {custom.map((d) => (
                  <label key={d} className="flex items-center gap-2 px-1 py-1 text-[13px]">
                    <input type="checkbox" checked readOnly className="accent-[#F26522]" /> {d}
                    <span className="ml-auto cursor-pointer text-red-600" onClick={() => setCustom(custom.filter((x) => x !== d))}>×</span>
                  </label>
                ))}
              </div>
              <input
                value={customInput} onChange={(e) => setCustomInput(e.target.value)} placeholder={t('district_custom_ph')} className={`${inputCls} mt-2`}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const v = customInput.trim();
                  if (v && !custom.includes(v)) setCustom([...custom, v]);
                  setCustomInput('');
                }}
              />
            </>
          )}
        </Dropdown>
      </div>

      <Field label={t('query')}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('query_ph')} list="gis-rubric-suggest" autoComplete="off" className={inputCls} />
        <datalist id="gis-rubric-suggest">{rubrics.slice(0, 400).map((r) => <option key={r.c} value={r.l} />)}</datalist>
      </Field>

      <div className="flex flex-col gap-1">
        <span className="text-[12px] text-gray-500">{t('rubric')}</span>
        <Dropdown label={rub ? rub.l : t('no_rubric')}>
          {(close) => (
            <>
              <input value={rubSearch} onChange={(e) => setRubSearch(e.target.value)} placeholder={t('rubric_search_ph')} className={inputCls} autoComplete="off" />
              <div className="mt-1.5 flex max-h-52 flex-col overflow-auto">
                <div onClick={() => { setRub(null); close(); }} className={`cursor-pointer rounded-lg px-2.5 py-1.5 text-[13px] ${!rub ? 'bg-[#F26522] text-white' : 'hover:bg-gray-50'}`}>{t('no_rubric_opt')}</div>
                {rubList.map((r) => (
                  <div key={r.c} onClick={() => { setRub({ c: r.c, l: r.l }); if (!query.trim()) setQuery(r.l); close(); }} className={`cursor-pointer rounded-lg px-2.5 py-1.5 text-[13px] ${rub?.c === r.c ? 'bg-[#F26522] text-white' : 'hover:bg-gray-50'}`}>{r.l}</div>
                ))}
              </div>
            </>
          )}
        </Dropdown>
      </div>

      <button type="button" onClick={add} className={btnDark}>{added !== null ? t('added') + added : t('add_links')}</button>
    </>
  );
}
