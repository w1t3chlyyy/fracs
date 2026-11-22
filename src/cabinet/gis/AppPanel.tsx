import { useEffect, useState } from 'react';
import { ApiError } from '../api';
import { Check, Copy, Download, KeyRound, Loader2, Monitor, ShieldCheck } from 'lucide-react';
import { btnOrange } from './ui';

interface Info {
  key: string;
  until: string | null;
  version: string | null;
  platforms: { id: string; label: string; available: boolean }[];
}

async function fetchInfo(): Promise<Info> {
  const r = await fetch('/api/app/info', { credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, j.error || 'error', j.message);
  return j as Info;
}

const STEPS: [string, string][] = [
  ['Скачайте и распакуйте', 'Выберите свою систему ниже и распакуйте архив в любую папку.'],
  ['Установите браузер', 'Нужен Google Chrome (или Microsoft Edge на Windows). Парсер управляет им, как обычный пользователь.'],
  ['Запустите FracsParser', 'Откроется окно консоли и страница программы в браузере. Не закрывайте консоль, пока идёт парсинг.'],
  ['Вставьте ключ', 'Один раз введите ключ из блока ниже. Дальше программа работает, пока активна подписка.'],
];

/** Раздел для подписчиков: скачивание программы и ключ лицензии. */
export default function AppPanel() {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => { fetchInfo().then(setInfo).catch((e) => setError(e.message || 'Не удалось загрузить данные')); }, []);

  const copy = async () => {
    if (!info) return;
    try { await navigator.clipboard.writeText(info.key); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* буфер недоступен */ }
  };

  if (error) return <p className="text-[13px] text-red-600">{error}</p>;
  if (!info) return <div className="flex items-center gap-2 py-8 text-[14px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Загружаем…</div>;

  const anyBuilt = info.platforms.some((p) => p.available);
  return (
    <div>
      <h2 className="font-heading text-2xl font-medium tracking-[-0.02em] text-gray-900 sm:text-3xl">Программа Fracs Parser</h2>
      <p className="mt-2 max-w-2xl text-[14px] text-gray-600">Реальный парсинг 2ГИС работает на вашем компьютере: без лимитов сервера, с фильтрами, шаблонами WhatsApp, выгрузкой HTML/CSV/XLSX/JSON и проходом по Яндекс Картам.</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="rounded-2xl bg-[#F9F9F9] p-5 sm:p-6">
          <h3 className="flex items-center gap-2 font-heading text-lg font-medium text-gray-900"><Download className="h-5 w-5 text-[#F26522]" /> Скачать{info.version ? <span className="text-[13px] font-normal text-gray-400">версия {info.version}</span> : null}</h3>
          <div className="mt-4 grid gap-2.5">
            {info.platforms.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
                <span className="flex items-center gap-2 text-[14px] font-medium text-gray-900"><Monitor className="h-4 w-4 text-gray-400" /> {p.label}</span>
                {p.available ? (
                  <a href={`/api/app/download/${p.id}`} className={`${btnOrange} !px-5 !py-2 !text-[13px] no-underline`}>Скачать</a>
                ) : (
                  <span className="text-[12px] text-gray-400">скоро</span>
                )}
              </div>
            ))}
          </div>
          {!anyBuilt && (
            <p className="mt-3 text-[12.5px] text-amber-700">
              Сборки ещё не опубликованы. Напишите в поддержку{' '}
              <a href="https://t.me/HelpManage" target="_blank" rel="noreferrer" className="underline font-medium hover:text-amber-900">@HelpManage</a>{' '}
              — пришлём файл вручную.
            </p>
          )}
          <p className="mt-4 text-[12px] leading-snug text-gray-500">Windows может показать предупреждение SmartScreen («Подробнее» → «Выполнить в любом случае»). На macOS: правый клик по программе → «Открыть».</p>
        </div>

        <div className="rounded-2xl bg-gray-900 p-5 text-white sm:p-6">
          <h3 className="flex items-center gap-2 font-heading text-lg font-medium"><KeyRound className="h-5 w-5 text-[#F26522]" /> Ключ лицензии</h3>
          <div className="mt-4 break-all rounded-xl bg-white/10 px-3.5 py-3 font-mono text-[12px] leading-relaxed text-gray-100 select-all">{info.key}</div>
          <button type="button" onClick={copy} className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#F26522] px-5 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-[#e05a1a] cursor-pointer">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Скопировано' : 'Скопировать ключ'}
          </button>
          <p className="mt-4 flex items-start gap-2 text-[12.5px] leading-snug text-gray-300">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            Ключ личный: не передавайте его другим. Подписка до {info.until ? new Date(info.until).toLocaleDateString('ru-RU') : '—'}; после окончания программа попросит продлить подписку.
          </p>
        </div>
      </div>

      <ol className="mt-6 grid gap-3 sm:grid-cols-2">
        {STEPS.map(([title, text], i) => (
          <li key={title} className="flex gap-3 rounded-2xl border border-gray-100 p-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-50 text-[13px] font-semibold text-[#F26522]">{i + 1}</span>
            <div>
              <p className="text-[14px] font-medium text-gray-900">{title}</p>
              <p className="mt-0.5 text-[13px] leading-snug text-gray-500">{text}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
