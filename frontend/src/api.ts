import { Trade, TradeFormData, Settings, ExitRecord, ActivityEntry } from './types';

const BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api';

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error: string };
    throw new Error(err.error || 'Request failed');
  }
  return (await res.json()) as T;
}

const h = <T>(res: Response) => handle<T>(res);

export const api = {
  // India trades
  getTrades: (): Promise<Trade[]> =>
    fetch(`${BASE}/trades`).then(h<Trade[]>),

  createTrade: (data: TradeFormData): Promise<Trade> =>
    fetch(`${BASE}/trades`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(h<Trade>),

  updateTrade: (id: number, data: TradeFormData): Promise<Trade> =>
    fetch(`${BASE}/trades/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(h<Trade>),

  deleteTrade: (id: number): Promise<{ success: boolean }> =>
    fetch(`${BASE}/trades/${id}`, { method: 'DELETE' }).then(h<{ success: boolean }>),

  // US trades
  getUsTrades: (): Promise<Trade[]> =>
    fetch(`${BASE}/us-trades`).then(h<Trade[]>),

  createUsTrade: (data: TradeFormData): Promise<Trade> =>
    fetch(`${BASE}/us-trades`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(h<Trade>),

  updateUsTrade: (id: number, data: TradeFormData): Promise<Trade> =>
    fetch(`${BASE}/us-trades/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(h<Trade>),

  deleteUsTrade: (id: number): Promise<{ success: boolean }> =>
    fetch(`${BASE}/us-trades/${id}`, { method: 'DELETE' }).then(h<{ success: boolean }>),

  // Exits (multiple partial closes)
  addExit: (id: number, exit: ExitRecord): Promise<Trade> =>
    fetch(`${BASE}/trades/${id}/exits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exit),
    }).then(h<Trade>),

  addUsExit: (id: number, exit: ExitRecord): Promise<Trade> =>
    fetch(`${BASE}/us-trades/${id}/exits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exit),
    }).then(h<Trade>),

  updateExits: (id: number, exits: ExitRecord[]): Promise<Trade> =>
    fetch(`${BASE}/trades/${id}/exits`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exits }),
    }).then(h<Trade>),

  updateUsExits: (id: number, exits: ExitRecord[]): Promise<Trade> =>
    fetch(`${BASE}/us-trades/${id}/exits`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exits }),
    }).then(h<Trade>),

  // Settings
  getSettings: (): Promise<Settings> =>
    fetch(`${BASE}/settings`).then(h<Settings>),

  updateSettings: (settings: Settings): Promise<Settings> =>
    fetch(`${BASE}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }).then(h<Settings>),
  getUsdToInrRate: (date: string): Promise<{ date: string; rate: number; fallback?: boolean }> =>
    fetch(`${BASE}/usd-to-inr/${date}`).then(h<{ date: string; rate: number; fallback?: boolean }>),

  // Stock prices
  getStockPrice: (symbol: string, exchange: string): Promise<{
    symbol: string;
    exchange: string;
    currentPrice: number;
    previousClose: number;
    dayHigh: number;
    dayLow: number;
    timestamp: number;
  }> =>
    fetch(`${BASE}/stock-price/${symbol}/${exchange}`).then(h<{
      symbol: string;
      exchange: string;
      currentPrice: number;
      previousClose: number;
      dayHigh: number;
      dayLow: number;
      timestamp: number;
    }>),

  getActivity: (): Promise<ActivityEntry[]> =>
    fetch(`${BASE}/activity`).then(h<ActivityEntry[]>),
};
