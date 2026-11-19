import { useCallback, useEffect, useState } from 'react';
import { STRINGS, type Lang } from './i18n';

export const digits = (s: string | undefined | null) => (s || '').replace(/\D/g, '');

/** Пропускает в href только http(s):// и tg:// ссылки; прочее (javascript:, data:…) → undefined.
 *  Защищает карточки результатов от XSS через сохранённые контакты/URL фирм. */
export const safeHref = (u?: string | null) => (u && /^(https?:\/\/|tg:\/\/)/i.test(u.trim()) ? u.trim() : undefined);

export function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* приватный режим */ }
}

/** Состояние, которое переживает перезагрузку страницы. */
export function usePersisted<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => load(key, initial));
  useEffect(() => save(key, v), [key, v]);
  return [v, setV] as const;
}

export function useLang() {
  const [lang, setLang] = usePersisted<Lang>('gis_lang', 'ru');
  const t = useCallback((k: string) => STRINGS[lang][k] ?? STRINGS.ru[k] ?? k, [lang]);
  return { lang, setLang, t };
}
export type TFn = (k: string) => string;

export const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(+d) ? '' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export function urlsSummary(urls: string[], more: string) {
  if (!urls.length) return '';
  let u = urls[0].replace(/^https?:\/\//, '');
  try { u = decodeURIComponent(u); } catch { /* оставляем как есть */ }
  return u + (urls.length > 1 ? ` +${urls.length - 1} ${more}` : '');
}
