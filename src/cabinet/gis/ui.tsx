import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export const inputCls =
  'w-full px-3.5 py-2.5 text-[14px] rounded-xl border border-gray-200 bg-white focus:outline-none focus:border-[#F26522] transition-colors';

/** Сворачиваемая секция левой панели. */
export function Section({ title, icon, children, onOpen, defaultOpen = false }: { title: string; icon?: ReactNode; children: ReactNode; onOpen?: () => void; defaultOpen?: boolean }) {
  return (
    <details
      open={defaultOpen}
      onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && onOpen?.()}
      className="group rounded-2xl border border-gray-200 bg-white"
    >
      <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-4 py-3 text-[13px] font-semibold text-gray-700 [&::-webkit-details-marker]:hidden">
        {icon && <span className="text-[#F26522]">{icon}</span>}
        {title}
        <ChevronDown className="ml-auto h-4 w-4 text-gray-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-2.5 px-4 pb-4">{children}</div>
    </details>
  );
}

export function Check({ checked, onChange, label, small }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; small?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-start gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-gray-50 ${small ? 'text-[12px]' : 'text-[13.5px]'} text-gray-800`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#F26522]" />
      <span>{label}</span>
    </label>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-gray-500">{label}</span>
      {children}
    </label>
  );
}

export function NumField({ label, value, onChange, min, max, step, placeholder }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; placeholder?: string }) {
  return (
    <Field label={label}>
      <input
        type="number" min={min} max={max} step={step} placeholder={placeholder} value={value || value === 0 ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        className={inputCls}
      />
    </Field>
  );
}

/** Выпадающий список с произвольным содержимым (города / районы / рубрики). */
export function Dropdown({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} className={`${inputCls} flex cursor-pointer items-center justify-between gap-2 text-left ${open ? '!border-[#F26522]' : ''}`}>
        <span className="truncate">{label}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="absolute left-0 right-0 top-full z-30 mt-1.5 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">{children(() => setOpen(false))}</div>}
    </div>
  );
}

export const btnDark = 'inline-flex items-center justify-center gap-2 rounded-full bg-gray-900 px-5 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-black disabled:opacity-50 cursor-pointer';
export const btnOrange = 'inline-flex items-center justify-center gap-2 rounded-full bg-[#F26522] px-6 py-2.5 text-[14px] font-medium text-white transition-colors hover:bg-[#e05a1a] disabled:opacity-60 cursor-pointer';
export const btnGhost = 'inline-flex items-center justify-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-[12.5px] font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50 cursor-pointer';
