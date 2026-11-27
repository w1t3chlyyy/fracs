import type { AppConfig, CityItem, Me, SearchView } from './types';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch('/api' + path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...init });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, j.error || 'error', j.message);
  return j as T;
}

const post = <T,>(path: string, body?: unknown) => req<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

export const api = {
  config: () => req<AppConfig>('/config'),
  me: () => req<Me>('/me'),
  authStart: () => post<{ token: string; url: string }>('/auth/start'),
  authStatus: (token: string) => req<{ status: 'pending' | 'ok' | 'expired' }>(`/auth/status?token=${encodeURIComponent(token)}`),
  /** Email-вход: просим отправить одноразовый код на почту. */
  emailStart: (email: string) => post<{ ok: true; email: string }>('/auth/email/start', { email }),
  /** Email-вход: подтверждаем код из письма, получаем сессию. */
  emailVerify: (email: string, code: string) => post<{ ok: true }>('/auth/email/verify', { email, code }),
  logout: () => post('/auth/logout'),
  cities: (q: string) => req<{ items: CityItem[] }>(`/cities?q=${encodeURIComponent(q)}`),
  searchMaps: (niche: string, cityId: string) => post<SearchView>('/search/maps', { niche, cityId }),
  mapsTrialStart: (body: { urls: string[]; maxRecords: number; filters: unknown; advanced: unknown; labels: Record<string, string> }) =>
    post<{ ticket: string; status: 'running' }>('/search/maps/trial/start', body),
  mapsTrialStatus: (ticket: string) => post<{
    status: 'running' | 'done' | 'error';
    count?: number;
    logs?: string[];
    empty?: boolean;
    error?: string;
    result?: SearchView;
  }>('/search/maps/trial/status', { ticket }),
  searchTg: (phrase: string, days: number) => post<SearchView>('/search/tg', { phrase, days }),
  history: (kind: 'maps' | 'tg') => req<{ items: SearchView[] }>(`/searches?kind=${kind}`),
  search: (id: string) => req<SearchView>(`/search/${id}`),
  rows: <T,>(id: string, offset: number, limit = 50) => req<{ rows: T[]; total: number }>(`/search/${id}/rows?offset=${offset}&limit=${limit}`),
  pay: (planId: string, method?: 'cryptobot' | 'xrocket') =>
    post<{ paymentId?: string; confirmationUrl?: string }>('/payments/create', { planId, method }),
  /** Заявка на подписку: админ получает уведомление в Telegram */
  requestPlan: (planId: string) => post<{ ok: boolean }>('/payments/request', { planId }),
};
