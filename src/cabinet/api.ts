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
  devLogin: () => post('/auth/dev'),
  logout: () => post('/auth/logout'),
  cities: (q: string) => req<{ items: CityItem[] }>(`/cities?q=${encodeURIComponent(q)}`),
  searchMaps: (niche: string, cityId: string) => post<SearchView>('/search/maps', { niche, cityId }),
  searchTg: (phrase: string, days: number) => post<SearchView>('/search/tg', { phrase, days }),
  history: (kind: 'maps' | 'tg') => req<{ items: SearchView[] }>(`/searches?kind=${kind}`),
  search: (id: string) => req<SearchView>(`/search/${id}`),
  rows: <T,>(id: string, offset: number, limit = 50) => req<{ rows: T[]; total: number }>(`/search/${id}/rows?offset=${offset}&limit=${limit}`),
  pay: (planId: string) => post<{ confirmationUrl?: string; activated?: boolean }>('/payments/create', { planId }),
};
