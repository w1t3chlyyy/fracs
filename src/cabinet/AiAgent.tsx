import { useState } from 'react';
import { Bot, FileArchive, FileImage, Play, Settings2, Sliders, Sparkles, Terminal, Upload } from 'lucide-react';
import { Section } from './gis/ui';

type Model = 'gpt-4o' | 'gpt-4o-mini' | 'claude-3.5-sonnet' | 'glm-4.6';
type Net = 'fracs-coder' | 'fracs-designer' | 'fracs-researcher';

const MODELS: { id: Model; label: string; hint: string }[] = [
  { id: 'gpt-4o', label: 'GPT-4o', hint: 'Универсальный, сильный в коде' },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini', hint: 'Быстрее и дешевле' },
  { id: 'claude-3.5-sonnet', label: 'Claude 3.5 Sonnet', hint: 'Тонкий текст и вёрстка' },
  { id: 'glm-4.6', label: 'GLM-4.6', hint: 'Локальный fallback' },
];
const NETS: { id: Net; label: string; hint: string }[] = [
  { id: 'fracs-coder', label: 'Fracs Coder', hint: 'Генерация сайтов по карточкам бизнеса' },
  { id: 'fracs-designer', label: 'Fracs Designer', hint: 'Дизайн-макеты и QR-код на макет' },
  { id: 'fracs-researcher', label: 'Fracs Researcher', hint: 'Анализ ниши и конкурентов' },
];

interface FileItem { id: string; name: string; size: string; Icon: typeof FileArchive }

const SEED_FILES: FileItem[] = [
  { id: 'f1', name: 'files-projects.zip', size: '4.2 МБ', Icon: FileArchive },
  { id: 'f2', name: 'qr-code.png', size: '12 КБ', Icon: FileImage },
];

/** Экран «AI-Агент» — настройка агента (ключ, модель, нейросеть, доп. промт) + холст агента + передача файлов.
 *  Пока без бэкенда: состояние локальное, «Запустить» переводит холст в состояние ожидания. */
export default function AiAgent() {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState<Model>('gpt-4o');
  const [net, setNet] = useState<Net>('fracs-coder');
  const [extra, setExtra] = useState('');
  const [headless, setHeadless] = useState(true);
  const [stream, setStream] = useState(true);
  const [maxTokens, setMaxTokens] = useState(4000);
  const [files, setFiles] = useState<FileItem[]>(SEED_FILES);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const keyOk = apiKey.trim().length > 8;

  const run = () => {
    if (!keyOk) return;
    setRunning(true);
    setLog([`[${new Date().toLocaleTimeString('ru-RU')}] Агент запускается…`, `Модель: ${model} · нейросеть: ${net}`, 'Ожидание задания…']);
    setTimeout(() => {
      setRunning(false);
      setLog((l) => [...l, 'Агент готов принять задание. Опишите его в поле выше.']);
    }, 1400);
  };

  const removeFile = (id: string) => setFiles((f) => f.filter((x) => x.id !== id));

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl sm:text-3xl font-medium tracking-[-0.02em] text-[#fbf3ea]">AI-Агент</h2>
          <p className="mt-1 text-[14px] text-[#d9c4b5] max-w-2xl">
            Настройте своего AI-агента за пару минут. Нейросеть создаёт сайты, анализируя карточки бизнеса или по вашему промту, и выдаёт QR-код на макет.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)_320px]">
        {/* Левая колонка — Настройка */}
        <aside className="ember-card rounded-3xl p-4 sm:p-5 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-[#F26522] text-white flex items-center justify-center"><Settings2 className="w-4 h-4" /></span>
            <h3 className="font-heading text-[15px] font-semibold text-[#fbf3ea]">Настройка</h3>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[#a08c7c]">API-ключ агента</span>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk_kw…"
                spellCheck={false}
                autoComplete="off"
                className="w-full px-3.5 py-2.5 pr-10 text-[14px] rounded-xl ember-input font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-[#a08c7c] hover:text-[#fbf3ea] px-1.5 py-1 cursor-pointer"
              >
                {showKey ? 'скр.' : 'пок.'}
              </button>
            </div>
            <span className={`text-[12px] leading-snug ${keyOk ? 'text-[#34d399]' : 'text-[#a08c7c]'}`}>
              {keyOk ? 'Ключ принят.' : 'Вставьте API-ключ вашего агента.'}
            </span>
          </label>

          <Section title="Модель" icon={<Sparkles className="w-4 h-4" />}>
            <div className="flex flex-col gap-1.5">
              {MODELS.map((m) => (
                <label key={m.id} className="flex items-start gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-[rgba(255,178,124,0.06)] cursor-pointer">
                  <input type="radio" name="model" checked={model === m.id} onChange={() => setModel(m.id)} className="mt-0.5 accent-[#F26522]" />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium text-[#fbf3ea]">{m.label}</span>
                    <span className="block text-[12px] text-[#a08c7c]">{m.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </Section>

          <Section title="Нейросеть" icon={<Bot className="w-4 h-4" />}>
            <div className="flex flex-col gap-1.5">
              {NETS.map((n) => (
                <label key={n.id} className="flex items-start gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-[rgba(255,178,124,0.06)] cursor-pointer">
                  <input type="radio" name="net" checked={net === n.id} onChange={() => setNet(n.id)} className="mt-0.5 accent-[#F26522]" />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium text-[#fbf3ea]">{n.label}</span>
                    <span className="block text-[12px] text-[#a08c7c]">{n.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </Section>

          <Section title="Доп. промт" icon={<Terminal className="w-4 h-4" />}>
            <textarea
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              rows={4}
              placeholder="Опишите стиль, тон, ограничения… Например: «сайт для автосервиса, тёмная тема, акцент — оранжевый, форма заявки сверху»."
              className="w-full px-3.5 py-2.5 text-[13px] rounded-xl ember-input resize-y leading-snug"
            />
          </Section>

          <Section title="Расширенные настройки" icon={<Sliders className="w-4 h-4" />}>
            <label className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-[rgba(255,178,124,0.06)] cursor-pointer text-[13.5px] text-[#fbf3ea]">
              <input type="checkbox" checked={headless} onChange={(e) => setHeadless(e.target.checked)} className="accent-[#F26522]" /> Скрытый браузер (headless)
            </label>
            <label className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-[rgba(255,178,124,0.06)] cursor-pointer text-[13.5px] text-[#fbf3ea]">
              <input type="checkbox" checked={stream} onChange={(e) => setStream(e.target.checked)} className="accent-[#F26522]" /> Потоковый ответ (stream)
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-[#a08c7c]">Макс. токенов: {maxTokens}</span>
              <input type="range" min={1000} max={16000} step={500} value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} className="accent-[#F26522]" />
            </label>
          </Section>

          <Section title="Тестировать" icon={<Play className="w-4 h-4" />}>
            <p className="text-[12.5px] leading-snug text-[#a08c7c]">
              Проверка связки «ключ → модель → нейросеть» без запуска полного задания. Запустит короткий пинг и покажет ответ.
            </p>
            <button type="button" disabled={!keyOk} className="mt-1 w-full px-4 py-2 rounded-full border border-[rgba(255,178,124,0.2)] text-[#d9c4b5] hover:text-[#fbf3ea] hover:bg-[rgba(255,178,124,0.08)] text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-50">
              Пинг агента
            </button>
          </Section>

          <button
            type="button"
            onClick={run}
            disabled={!keyOk || running}
            className="mt-1 inline-flex items-center justify-center gap-2 rounded-full bg-[#F26522] hover:bg-[#e05a1a] disabled:opacity-50 px-6 py-3 text-[14px] font-medium text-white transition-colors cursor-pointer"
          >
            <Play className="w-4 h-4" /> {running ? 'Запуск…' : 'Запустить'}
          </button>
        </aside>

        {/* Центр — холст агента */}
        <section className="ember-card rounded-3xl p-4 sm:p-6 min-h-[60vh] flex flex-col">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-heading text-[15px] font-semibold text-[#fbf3ea]">Ваш личный AI-Агент</h3>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${running ? 'bg-[rgba(242,101,34,0.15)] text-[#ffb27c]' : 'bg-[rgba(255,255,255,0.05)] text-[#a08c7c]'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${running ? 'bg-[#F26522] animate-pulse' : 'bg-[#a08c7c]'}`} />
              {running ? 'Работает' : 'Готов'}
            </span>
          </div>

          {log.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
              <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-[rgba(255,178,124,0.08)] border border-[rgba(255,178,124,0.18)] flex items-center justify-center">
                <Bot className="w-7 h-7 text-[#ffb27c]" />
              </div>
              <p className="font-heading text-lg font-medium text-[#fbf3ea]">Агент ждёт задание</p>
              <p className="mt-1.5 max-w-sm text-[13px] text-[#a08c7c] leading-relaxed">
                Вставьте API-ключ слева, выберите модель и нейросеть, нажмите «Запустить» — и опишите, что сделать: сайт по карточке бизнеса, макет с QR-кодом или анализ ниши.
              </p>
            </div>
          ) : (
            <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[rgba(0,0,0,0.3)] border border-[rgba(255,178,124,0.1)] p-4 font-mono text-[12.5px] leading-relaxed text-[#d9c4b5]">{log.join('\n')}</pre>
          )}
        </section>

        {/* Правая колонка — Передача файлов */}
        <aside className="ember-card rounded-3xl p-4 sm:p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-heading text-[15px] font-semibold text-[#fbf3ea]">Передача файлов</h3>
            <span className="text-[12px] text-[#a08c7c]">{files.length}</span>
          </div>

          <label className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[rgba(255,178,124,0.2)] bg-[rgba(255,178,124,0.03)] px-4 py-6 text-center cursor-pointer hover:bg-[rgba(255,178,124,0.07)] transition-colors">
            <Upload className="w-5 h-5 text-[#a08c7c]" />
            <span className="text-[13px] font-medium text-[#d9c4b5]">Перетащите файлы или нажмите</span>
            <span className="text-[11px] text-[#a08c7c]">.zip, .png, .csv, .json — до 25 МБ</span>
            <input type="file" multiple className="hidden" onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              if (!list.length) return;
              setFiles((prev) => [...prev, ...list.map((f) => ({
                id: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
                name: f.name,
                size: `${(f.size / 1024 / 1024).toFixed(1)} МБ`,
                Icon: /\.png$/i.test(f.name) ? FileImage : FileArchive,
              }))]);
            }} />
          </label>

          <div className="flex flex-col gap-2">
            {files.length === 0 && <p className="text-[12.5px] text-[#a08c7c] text-center py-4">Файлов пока нет.</p>}
            {files.map((f) => (
              <div key={f.id} className="flex items-center gap-3 rounded-xl border border-[rgba(255,178,124,0.12)] bg-[rgba(255,255,255,0.02)] px-3 py-2.5">
                <span className="w-9 h-9 rounded-lg bg-[rgba(255,178,124,0.08)] flex items-center justify-center shrink-0">
                  <f.Icon className="w-4 h-4 text-[#ffb27c]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-[#fbf3ea]">{f.name}</p>
                  <p className="text-[11px] text-[#a08c7c]">{f.size}</p>
                </div>
                <button onClick={() => removeFile(f.id)} aria-label={`Удалить ${f.name}`} className="text-[#a08c7c] hover:text-[#ff8a5b] text-[16px] leading-none px-1 cursor-pointer">×</button>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
