import type React from 'react';
import { Globe, Mail, Phone, Star } from 'lucide-react';
import type { GisRecord } from './types';
import { digits, safeHref, type TFn } from './lib';

export interface Mark { status?: string; note?: string }

export const bizId = (r: GisRecord) => r.url?.split('/firm/')[1] || r.url || r.name;

const chip = 'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-semibold no-underline transition-[filter] hover:brightness-110';

interface Props {
  r: GisRecord;
  t: TFn;
  blurred?: boolean;
  /** Демо: контакты выдуманные, ссылки отключены */
  demo?: boolean;
  mark?: Mark;
  onMark?: (patch: Mark) => void;
  waUrl?: (num: string) => string;
}

export default function RecordCard({ r, t, blurred, demo, mark, onMark, waUrl }: Props) {
  const c = r.contacts || {};
  const done = mark?.status === 'contacted';
  const blur = blurred ? 'blur-[3px] select-none' : '';
  const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;
  const inert = (e: React.MouseEvent) => demo && e.preventDefault();
  return (
    <article className={`flex flex-col gap-2 rounded-2xl border border-[rgba(255,255,255,0.12)] ember-card p-4 transition-shadow hover:shadow-md ${done ? 'opacity-55 hover:opacity-85' : ''}`}>
      <div className="flex items-baseline justify-between gap-2.5">
        {demo && <span className="mr-1 shrink-0 rounded bg-[rgba(255,255,255,0.06)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#888888]">демо</span>}
        <h3 className={`font-heading text-[16px] font-semibold leading-tight text-[#ffffff] ${blur}`}>{r.name}</h3>
        {r.rating ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.1)] px-2 py-0.5 text-[12px] font-medium text-[#ffffff]">
            <Star className="h-3 w-3 fill-current" /> {r.rating}{r.review_count ? ` · ${r.review_count}` : ''}
          </span>
        ) : null}
      </div>
      {r.rubrics.length > 0 && <div className="text-[12.5px] font-medium text-[#F26522]">{r.rubrics.join(' · ')}</div>}
      {(r.address || r.city) && <div className={`text-[13px] leading-snug text-[#888888] ${blur}`}>{[r.address, r.city].filter(Boolean).join(', ')}</div>}
      {r.district && <div className="text-[11.5px] text-[#666666]">{r.district}</div>}

      <div className={`mt-1 flex flex-wrap gap-1.5 ${blur}`}>
        {c.whatsapp && !blurred && waUrl && (
          <a href="#" onClick={(e) => { e.preventDefault(); if (!demo) window.open(waUrl(c.whatsapp), '_blank', 'noopener'); }} className={`${chip} border-transparent bg-[#25d366] text-white`}>WhatsApp</a>
        )}
        {c.phone && <a href={blurred || demo ? undefined : `tel:${digits(c.phone)}`} className={`${chip} border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.04)] text-[#ffffff]`}><Phone className="h-3.5 w-3.5" /> {c.phone}</a>}
        {!blurred && c.telegram && <a href={demo ? undefined : safeHref(c.telegram)} onClick={inert} {...ext} className={`${chip} border-[rgba(56,189,248,0.25)] bg-[rgba(56,189,248,0.12)] text-[#7dd3fc]`}>Telegram</a>}
        {!blurred && c.instagram && <a href={demo ? undefined : safeHref(c.instagram)} onClick={inert} {...ext} className={`${chip} border-[rgba(244,114,182,0.25)] bg-[rgba(244,114,182,0.12)] text-[#f9a8d4]`}>Instagram</a>}
        {!blurred && c.website && <a href={demo ? undefined : safeHref(c.website)} onClick={inert} {...ext} className={`${chip} border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.04)] text-[#ffffff]`}><Globe className="h-3.5 w-3.5" /> Сайт</a>}
        {!blurred && c.email && <a href={demo ? undefined : `mailto:${c.email}`} className={`${chip} border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.04)] text-[#ffffff]`}><Mail className="h-3.5 w-3.5" /> E-mail</a>}
        {!blurred && r.url && <a href={demo ? undefined : safeHref(r.url)} onClick={inert} {...ext} className={`${chip} border-[rgba(16,185,129,0.25)] bg-[rgba(16,185,129,0.12)] text-[#34d399]`}>2ГИС</a>}
      </div>

      {!blurred && onMark && (
        <div className="mt-1 flex items-center gap-2 border-t border-dashed border-[rgba(255,255,255,0.14)] pt-2.5">
          <button
            type="button" onClick={() => onMark({ status: done ? '' : 'contacted' })}
            className={`shrink-0 cursor-pointer rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold ${done ? 'border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.12)] text-[#34d399]' : 'border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.03)] text-[#888888]'}`}
          >{t(done ? 'mark_on' : 'mark')}</button>
          <input
            value={mark?.note ?? ''} onChange={(e) => onMark({ note: e.target.value })} placeholder={t('note_ph')}
            className="min-w-0 flex-1 rounded-lg border border-[rgba(255,255,255,0.14)] bg-[rgba(0,0,0,0.25)] px-2.5 py-1.5 text-[12.5px] text-[#ffffff] focus:border-[#F26522] focus:outline-none"
          />
        </div>
      )}
    </article>
  );
}
