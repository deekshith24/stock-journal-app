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
  entry_date: string;       // YYYY-MM-DD
  exit_date: string | null; // YYYY-MM-DD or null when trade is open
  entry_quantity: number;
  exit_quantity: number | null;
  entry_price: number;
  exit_price: number | null;
  reason_for_entry: string;
  reason_for_exit: string;
  emotions: string;
  created_at?: string;
  exits?: ExitRecord[];
}

export interface TradeWithCalculated extends Trade {
  status: 'Open' | 'Partial' | 'Closed';
  days_in_trade: string;   // e.g. "17d"
  invested: number;        // entry_price * entry_quantity
  pf_percentage: number;   // invested / portfolio_size * 100
  pl: number;              // (exit_price - entry_price) * exit_quantity
  pl_percentage: number;   // pl / invested * 100
}

export interface Settings {
  portfolio_size: number;
  us_portfolio_size: number;
  usd_to_inr: number;
}
