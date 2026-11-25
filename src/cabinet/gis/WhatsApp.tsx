import { MessageCircle } from 'lucide-react';
import { usePersisted, type TFn } from './lib';
import { Field, Section, btnGhost, inputCls } from './ui';

/** Шаблоны сообщений и режим открытия Telegram (хранятся в браузере). */
export function useTelegram() {
  const [mode, setMode] = usePersisted<'web' | 'app'>('gis_wa_mode', 'web');
  const [templates, setTemplates] = usePersisted<string[]>('gis_wa_texts', ['']);

  // raw — контакт Telegram из 2ГИС (t.me/username, tg://resolve?domain=…). Пустая строка — не удалось разобрать.
  const waUrl = (raw: string) => {
    const m = raw.match(/(?:t\.me|telegram\.me)\/(@?[A-Za-z0-9_+]+)/i) || raw.match(/[?&]domain=([A-Za-z0-9_]+)/i) || raw.match(/^@?([A-Za-z0-9_]{4,})$/);
    const h = m ? m[1].replace(/^@/, '') : '';
    if (!h) return '';
    const tpls = templates.map((x) => x.trim()).filter(Boolean);
    const text = tpls.length ? tpls[Math.floor(Math.random() * tpls.length)] : '';
    // запасной путь: если клиент Telegram не подставит ?text=, шаблон уже в буфере обмена
    if (text) { try { void navigator.clipboard.writeText(text); } catch { /* нет доступа к буферу */ } }
    return mode === 'web'
      ? `https://web.telegram.org/k/#${h.startsWith('+') ? h : '@' + h}`
      : `https://t.me/${h}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  };
  return { mode, setMode, templates, setTemplates, waUrl };
}

export function TelegramSection({ t, wa }: { t: TFn; wa: ReturnType<typeof useTelegram> }) {
  const { templates, setTemplates } = wa;
  return (
    <Section title={t('wa_title')} icon={<MessageCircle className="h-4 w-4" />}>
      <Field label={t('wa_mode_label')}>
        <select value={wa.mode} onChange={(e) => wa.setMode(e.target.value as 'web' | 'app')} className={inputCls}>
          <option value="web">{t('wa_web')}</option>
          <option value="app">{t('wa_app')}</option>
        </select>
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] text-gray-500">{t('wa_templates')}</span>
        {templates.map((v, i) => (
          <div key={i} className="flex gap-1.5">
            <input value={v} placeholder={t('wa_tpl_ph')} onChange={(e) => setTemplates(templates.map((x, j) => (j === i ? e.target.value : x)))} className={`${inputCls} min-w-0`} />
            <button
              type="button" aria-label="Удалить"
              onClick={() => setTemplates(templates.length > 1 ? templates.filter((_, j) => j !== i) : [''])}
              className="w-10 shrink-0 cursor-pointer rounded-xl border border-gray-200 bg-white text-red-600 hover:bg-red-50"
            >×</button>
          </div>
        ))}
        <button type="button" onClick={() => setTemplates([...templates, ''])} className={`${btnGhost} self-start`}>{t('wa_add')}</button>
      </div>
      <p className="text-[12px] leading-snug text-gray-500">{t('wa_hint')}</p>
    </Section>
  );
}
