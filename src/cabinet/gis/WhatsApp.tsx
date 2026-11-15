import { MessageCircle } from 'lucide-react';
import { digits, usePersisted, type TFn } from './lib';
import { Field, Section, btnGhost, inputCls } from './ui';

/** Шаблоны сообщений и режим открытия WhatsApp (хранятся в браузере). */
export function useWhatsApp() {
  const [mode, setMode] = usePersisted<'web' | 'app'>('gis_wa_mode', 'web');
  const [templates, setTemplates] = usePersisted<string[]>('gis_wa_texts', ['']);

  const waUrl = (raw: string) => {
    const number = digits(raw);
    const tpls = templates.map((x) => x.trim()).filter(Boolean);
    const text = tpls.length ? tpls[Math.floor(Math.random() * tpls.length)] : '';
    const q = text ? encodeURIComponent(text) : '';
    return mode === 'web'
      ? `https://web.whatsapp.com/send?phone=${number}${q ? `&text=${q}` : ''}`
      : `https://wa.me/${number}${q ? `?text=${q}` : ''}`;
  };
  return { mode, setMode, templates, setTemplates, waUrl };
}

export function WhatsAppSection({ t, wa }: { t: TFn; wa: ReturnType<typeof useWhatsApp> }) {
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
