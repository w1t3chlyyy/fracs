import { ArrowRight } from 'lucide-react';

/** Плавающая кнопка входа в кабинет на лендинге — не требует правок в App.tsx. */
export default function CabinetFab() {
  return (
    <a
      href="/app"
      className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 pl-5 pr-2 py-2 rounded-full bg-gray-900 hover:bg-black text-white text-[13px] font-medium shadow-lg transition-colors"
    >
      Личный кабинет
      <span className="w-7 h-7 rounded-full bg-white text-gray-900 flex items-center justify-center">
        <ArrowRight className="w-3.5 h-3.5" />
      </span>
    </a>
  );
}
