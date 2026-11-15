import { Filter, ListChecks, SlidersHorizontal } from 'lucide-react';
import type { Advanced, Filters, Settings } from './types';
import type { TFn } from './lib';
import { Check, Field, NumField, Section, inputCls } from './ui';

interface Props {
  t: TFn;
  s: Settings;
  setS: (s: Settings) => void;
  maxRecords: number;
}

/** Фильтры, параметры и расширенные настройки (из оригинального дашборда). */
export default function SettingsSections({ t, s, setS, maxRecords }: Props) {
  const f = s.filters;
  const a = s.advanced;
  const setF = (p: Partial<Filters>) => setS({ ...s, filters: { ...f, ...p } });
  const setA = (p: Partial<Advanced>) => setS({ ...s, advanced: { ...a, ...p } });

  return (
    <>
      <Section title={t('filters_title')} icon={<Filter className="h-4 w-4" />}>
        <Check checked={f.dedup_across_niches} onChange={(v) => setF({ dedup_across_niches: v })} label={t('f_dedup_niches')} />
        <Check checked={f.dedup_franchises} onChange={(v) => setF({ dedup_franchises: v })} label={t('f_dedup')} />
        <Check checked={f.require_phone} onChange={(v) => setF({ require_phone: v })} label={t('f_phone')} />
        <Check checked={f.require_whatsapp} onChange={(v) => setF({ require_whatsapp: v })} label={t('f_wa')} />
        <Check checked={f.require_social} onChange={(v) => setF({ require_social: v })} label={t('f_social')} />
        <Check checked={f.require_email} onChange={(v) => setF({ require_email: v })} label={t('f_email')} />
        <Check checked={f.require_website} onChange={(v) => setF({ require_website: v, require_no_website: v ? false : f.require_no_website })} label={t('f_site')} />
        <Check checked={f.require_no_website} onChange={(v) => setF({ require_no_website: v, require_website: v ? false : f.require_website })} label={t('f_nosite')} />
        <div className="grid grid-cols-2 gap-2.5">
          <NumField label={t('rating_from')} value={f.min_rating} min={0} max={5} step={0.1} onChange={(n) => setF({ min_rating: n })} />
          <NumField label={t('reviews_from')} value={f.min_reviews} min={0} step={1} onChange={(n) => setF({ min_reviews: n })} />
        </div>
      </Section>

      <Section title={t('params_title')} icon={<ListChecks className="h-4 w-4" />}>
        <NumField label={`${t('maxrec')} (≤ ${maxRecords})`} value={s.max_records} min={1} max={maxRecords} step={1} onChange={(n) => setS({ ...s, max_records: n })} />
        <Check checked={s.clean} onChange={(v) => setS({ ...s, clean: v })} label={t('clean')} />
      </Section>

      <Section title={t('adv_title')} icon={<SlidersHorizontal className="h-4 w-4" />}>
        <Check checked={a.disable_images} onChange={(v) => setA({ disable_images: v })} label={t('a_images')} />
        <Check checked={a.skip_404_response} onChange={(v) => setA({ skip_404_response: v })} label={t('a_skip404')} />
        <Check checked={a.add_rubrics} onChange={(v) => setA({ add_rubrics: v })} label={t('a_rubrics')} />
        <Check checked={a.add_comments} onChange={(v) => setA({ add_comments: v })} label={t('a_comments')} />
        <Check checked={a.remove_empty_columns} onChange={(v) => setA({ remove_empty_columns: v })} label={t('a_rmempty')} />
        <Check checked={a.remove_duplicates} onChange={(v) => setA({ remove_duplicates: v })} label={t('a_rmdup')} />
        <div className="grid grid-cols-2 gap-2.5">
          <NumField label={t('a_delay')} value={a.delay_between_clicks} min={0} max={5000} step={50} onChange={(n) => setA({ delay_between_clicks: n })} />
          <NumField label={t('a_cols')} value={a.columns_per_entity} min={1} max={5} onChange={(n) => setA({ columns_per_entity: n })} />
        </div>
        <Field label={t('a_enc')}>
          <select value={a.encoding} onChange={(e) => setA({ encoding: e.target.value })} className={inputCls}>
            <option value="utf-8-sig">UTF-8 (Excel)</option>
            <option value="utf-8">UTF-8</option>
            <option value="cp1251">Windows-1251</option>
          </select>
        </Field>
      </Section>
    </>
  );
}
