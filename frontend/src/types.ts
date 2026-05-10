export interface ExitRecord {
  date: string;
  quantity: number;
  price: number;
  reason: string;
  emotions: string;
}

export interface Trade {
  id?: number;
  stock: string;
  trade_type?: 'swing' | 'positional';
  entry_date: string;
  exit_date: string | null;
  entry_quantity: number;
  exit_quantity: number | null;
  entry_price: number;
  exit_price: number | null;
  stop_loss?: number | null;
  reason_for_entry: string;
  reason_for_exit: string;
  emotions: string;
  created_at?: string;
  exits?: ExitRecord[];
  // Calculated by backend
  status?: 'Open' | 'Partial' | 'Closed';
  days_in_trade?: string;
  invested?: number;
  pf_percentage?: number;
  pl?: number;
  pl_percentage?: number;
}

export interface Settings {
  portfolio_size: number;
  us_portfolio_size: number;
  usd_to_inr: number;
}

export interface StockPrice {
  symbol: string;
  exchange: string;
  currentPrice: number;
  previousClose: number;
  dayHigh: number;
  dayLow: number;
  timestamp: number;
}

export type TradeFormData = Omit<Trade, 'id' | 'created_at' | 'status' | 'days_in_trade' | 'invested' | 'pf_percentage' | 'pl' | 'pl_percentage'>;

export interface ActivityEntry {
  id: number;
  timestamp: string;
  action: string;
  market: 'India' | 'US';
  trade_id: number;
  stock: string;
  details: string;
}
