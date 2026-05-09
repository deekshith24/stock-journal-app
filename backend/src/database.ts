import { createClient } from '@supabase/supabase-js';
import { Trade } from './types';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export interface ActivityEntry {
  id: number;
  timestamp: string;
  action: string;
  market: 'India' | 'US';
  trade_id: number;
  stock: string;
  details: string;
}

// ── India trades ──────────────────────────────────────────────────────────────

export async function getAllTrades(): Promise<Trade[]> {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .order('entry_date', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Trade[];
}

export async function getTradeById(id: number): Promise<Trade | undefined> {
  const { data } = await supabase.from('trades').select('*').eq('id', id).single();
  return data as Trade | undefined;
}

export async function createTrade(data: Omit<Trade, 'id' | 'created_at'>): Promise<Trade> {
  const { data: trade, error } = await supabase.from('trades').insert(data).select().single();
  if (error) throw new Error(error.message);
  return trade as Trade;
}

export async function updateTrade(id: number, data: Partial<Trade>): Promise<Trade | null> {
  const { data: trade, error } = await supabase
    .from('trades').update(data).eq('id', id).select().single();
  if (error) return null;
  return trade as Trade;
}

export async function deleteTrade(id: number): Promise<boolean> {
  const { error } = await supabase.from('trades').delete().eq('id', id);
  return !error;
}

// ── US trades ─────────────────────────────────────────────────────────────────

export async function getAllUsTrades(): Promise<Trade[]> {
  const { data, error } = await supabase
    .from('us_trades')
    .select('*')
    .order('entry_date', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Trade[];
}

export async function getUsTradeById(id: number): Promise<Trade | undefined> {
  const { data } = await supabase.from('us_trades').select('*').eq('id', id).single();
  return data as Trade | undefined;
}

export async function createUsTrade(data: Omit<Trade, 'id' | 'created_at'>): Promise<Trade> {
  const { data: trade, error } = await supabase.from('us_trades').insert(data).select().single();
  if (error) throw new Error(error.message);
  return trade as Trade;
}

export async function updateUsTrade(id: number, data: Partial<Trade>): Promise<Trade | null> {
  const { data: trade, error } = await supabase
    .from('us_trades').update(data).eq('id', id).select().single();
  if (error) return null;
  return trade as Trade;
}

export async function deleteUsTrade(id: number): Promise<boolean> {
  const { error } = await supabase.from('us_trades').delete().eq('id', id);
  return !error;
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<{ portfolio_size: number; us_portfolio_size: number; usd_to_inr: number }> {
  const { data } = await supabase.from('settings').select('*').eq('id', 1).single();
  if (!data) return { portfolio_size: 300000, us_portfolio_size: 50000, usd_to_inr: 84 };
  return {
    portfolio_size: data.portfolio_size ?? 300000,
    us_portfolio_size: data.us_portfolio_size ?? 50000,
    usd_to_inr: data.usd_to_inr ?? 84,
  };
}

export async function saveSettings(s: { portfolio_size: number; us_portfolio_size: number; usd_to_inr: number }): Promise<void> {
  await supabase.from('settings').upsert({ id: 1, ...s });
}

// ── Activity log ──────────────────────────────────────────────────────────────

export async function logActivity(entry: Omit<ActivityEntry, 'id'>): Promise<void> {
  await supabase.from('activity').insert(entry);
}

export async function getActivityLog(): Promise<ActivityEntry[]> {
  const { data } = await supabase
    .from('activity')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(2000);
  return (data ?? []) as ActivityEntry[];
}
