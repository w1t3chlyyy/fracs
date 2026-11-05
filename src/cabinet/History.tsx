import { useEffect, useState } from 'react';
import { api } from './api';
import type { SearchView } from './types';

export default function History({ kind, refreshKey, onOpen }: { kind: 'maps' | 'tg'; refreshKey: string; onOpen: (s: SearchView) => void }) {
  const [items, setItems] = useState<SearchView[]>([]);
  useEffect(() => {
    api.history(kind).then((r) => setItems(r.items)).catch(() => {});
  }, [kind, refreshKey]);
  if (!items.length) return null;
  return (
    <div className="mt-8 pt-6 border-t border-gray-100">
      <p className="text-[13px] font-medium text-gray-500 mb-3">Недавние запросы</p>
      <div className="flex flex-wrap gap-2">
        {items.map((s) => (
          <button key={s.id} onClick={() => onOpen(s)} className="px-3.5 py-1.5 rounded-full bg-gray-100 hover:bg-gray-200 text-[13px] text-gray-700 transition-colors cursor-pointer">
            {kind === 'maps' ? `${s.query.niche} · ${s.query.cityLabel?.split(',')[0]}` : s.query.phrase}
          </button>
        ))}
      </div>
    </div>
  );
}
