export interface Plan { id: string; title: string; days: number; priceRub: number; badge?: string; description?: string; features?: string[] }
export interface AppConfig {
  devLogin: boolean;
  payment: 'mock' | 'yookassa';
  plans: Plan[];
  demo: { maps: boolean; tg: boolean };
  /** Если задан — оплата идёт через чат с админом в Telegram (t.me/<adminUsername>) */
  adminUsername?: string;
}
export interface Me {
  user: { id: string; firstName: string; username: string | null } | null;
  admin?: boolean;
  subscription?: { active: boolean; until: string | null };
  features?: string[];
  /** true — пользователь отписался от обязательных каналов: действия в кабинете блокируются. */
  channelsRequired?: boolean;
  trial?: { maps: boolean; tg: boolean };
  quota?: { used: number; limit: number };
}
export interface CityItem { id: string; name: string; region: string }

export interface MapsRow { id: string; name: string; category: string; address: string; phone: string | null; rating: number | null; reviews: number | null; url: string | null }
export interface TgRow { id: string; username: string; name: string; chat: string; text: string; date: string; link: string }

export interface SearchView {
  id: string;
  kind: 'maps' | 'tg';
  createdAt: string;
  demo: boolean;
  query: { niche?: string; cityLabel?: string; phrase?: string; days?: number };
  stats: Record<string, number>;
  rowsTotal: number;
  teaser: (MapsRow | TgRow)[];
  /** Полные строки одноразового Maps trial; API отдаёт их только при первом успешном poll. */
  trialRows?: MapsRow[];
}
