import { Trade, TradeFormData, Settings, ExitRecord, ActivityEntry } from './types';
import { supabase } from './supabaseClient';

const BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api';

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: await authHeaders() });
  return handle(res);
}

async function mutate<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handle(res);
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error: string };
    throw new Error(err.error || 'Request failed');
  }
  return (await res.json()) as T;
}

export const api = {
  getTrades: () => get<Trade[]>(`${BASE}/trades`),
  createTrade: (data: TradeFormData) => mutate<Trade>(`${BASE}/trades`, 'POST', data),
  updateTrade: (id: number, data: TradeFormData) => mutate<Trade>(`${BASE}/trades/${id}`, 'PUT', data),
  deleteTrade: (id: number) => mutate<{ success: boolean }>(`${BASE}/trades/${id}`, 'DELETE'),

  getUsTrades: () => get<Trade[]>(`${BASE}/us-trades`),
  createUsTrade: (data: TradeFormData) => mutate<Trade>(`${BASE}/us-trades`, 'POST', data),
  updateUsTrade: (id: number, data: TradeFormData) => mutate<Trade>(`${BASE}/us-trades/${id}`, 'PUT', data),
  deleteUsTrade: (id: number) => mutate<{ success: boolean }>(`${BASE}/us-trades/${id}`, 'DELETE'),

  addExit: (id: number, exit: ExitRecord) => mutate<Trade>(`${BASE}/trades/${id}/exits`, 'POST', exit),
  addUsExit: (id: number, exit: ExitRecord) => mutate<Trade>(`${BASE}/us-trades/${id}/exits`, 'POST', exit),
  updateExits: (id: number, exits: ExitRecord[]) => mutate<Trade>(`${BASE}/trades/${id}/exits`, 'PUT', { exits }),
  updateUsExits: (id: number, exits: ExitRecord[]) => mutate<Trade>(`${BASE}/us-trades/${id}/exits`, 'PUT', { exits }),

  getSettings: () => get<Settings>(`${BASE}/settings`),
  updateSettings: (settings: Settings) => mutate<Settings>(`${BASE}/settings`, 'PUT', settings),

  getUsdToInrRate: (date: string) => get<{ date: string; rate: number; fallback?: boolean }>(`${BASE}/usd-to-inr/${date}`),

  getStockPrice: (symbol: string, exchange: string) => get<{
    symbol: string; exchange: string; currentPrice: number;
    previousClose: number; dayHigh: number; dayLow: number; timestamp: number;
  }>(`${BASE}/stock-price/${symbol}/${exchange}`),

  getActivity: () => get<ActivityEntry[]>(`${BASE}/activity`),
};
