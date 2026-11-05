export interface Plan { id: string; title: string; days: number; priceRub: number; badge?: string }
export interface AppConfig { devLogin: boolean; payment: 'mock' | 'yookassa'; plans: Plan[]; demo: { maps: boolean; tg: boolean } }
export interface Me {
  user: { id: string; firstName: string; username: string | null } | null;
  subscription?: { active: boolean; until: string | null };
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
}
