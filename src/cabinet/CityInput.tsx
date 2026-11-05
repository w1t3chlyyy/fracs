import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { api } from './api';
import type { CityItem } from './types';

interface Props {
  selected: CityItem | null;
  onSelect: (c: CityItem | null) => void;
}

/** Поле города с подсказками: понимает раскладку («rfpfym»), опечатки и сокращения. */
export default function CityInput({ selected, onSelect }: Props) {
  const [text, setText] = useState(selected ? selected.name : '');
  const [items, setItems] = useState<CityItem[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const reqId = useRef(0);

  useEffect(() => {
    if (!open) return;
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      try {
        const r = await api.cities(text);
        if (id === reqId.current) {
          setItems(r.items);
          setActive(0);
        }
      } catch {
        /* подсказки необязательны */
      }
    }, 120);
    return () => clearTimeout(t);
  }, [text, open]);

  const choose = (c: CityItem) => {
    setText(c.name);
    onSelect(c);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) return setOpen(true);
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open && items[active]) { e.preventDefault(); choose(items[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="relative">
      <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (selected) onSelect(null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKey}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="Начните вводить город"
        className="w-full pl-10 pr-3.5 py-2.5 text-[14px] rounded-xl border border-gray-200 bg-white focus:outline-none focus:border-[#F26522] transition-colors"
      />
      {open && items.length > 0 && (
        <ul role="listbox" className="absolute z-30 mt-1.5 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-72 overflow-y-auto">
          {items.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); choose(c); }}
              onMouseEnter={() => setActive(i)}
              className={`px-3.5 py-2 cursor-pointer flex items-baseline justify-between gap-3 text-[14px] ${i === active ? 'bg-orange-50' : ''}`}
            >
              <span className="font-medium text-gray-900">{c.name}</span>
              <span className="text-[12px] text-gray-400 truncate">{c.region}</span>
            </li>
          ))}
        </ul>
      )}
      {!selected && text.trim().length > 0 && !open && (
        <p className="text-[12px] text-amber-600 mt-1.5">Выберите город из списка подсказок</p>
      )}
    </div>
  );
}
