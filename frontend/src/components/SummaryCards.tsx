import { Trade, ExitRecord, StockPrice } from '../types';

interface Props {
  trades: Trade[];
  currency: 'INR' | 'USD';
  exchangeRate?: number;
  dateRates?: Record<string, number>;
  stockPrices?: Record<string, StockPrice>;
  exchange: 'US' | 'IN';
  title?: string;
  compact?: boolean;
}

function fmt(n: number, decimals = 0, locale = 'en-IN'): string {
  return n.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Shares still held (handles both exits array and legacy scalar)
function remainingQty(t: Trade): number {
  const exited = t.exits && t.exits.length > 0
    ? t.exits.reduce((s: number, e: ExitRecord) => s + e.quantity, 0)
    : (t.exit_quantity ?? 0);
  return Math.max(0, t.entry_quantity - exited);
}

function calcMetrics(
  trades: Trade[],
  currency: 'INR' | 'USD',
  exchange: 'US' | 'IN',
  rate: number,
  dateRates?: Record<string, number>,
  stockPrices?: Record<string, StockPrice>,
) {
  const closed = trades.filter(t => t.status === 'Closed');
  // Include Partial positions — they still have capital at risk
  const open   = trades.filter(t => t.status === 'Open' || t.status === 'Partial');
  // Trades with any realized P&L: fully closed + partially closed
  const realized = trades.filter(t => t.status === 'Closed' || t.status === 'Partial');

  // For realised P&L use the entry-date rate (what was actually paid)
  const applyRate = (t: Trade) =>
    currency === 'INR' && exchange === 'US' ? (dateRates?.[t.entry_date] ?? rate) : 1;

  // For current market values use today's rate
  const todayRate = currency === 'INR' && exchange === 'US' ? rate : 1;

  // Invested amount for only the exited portion (correct denominator for P&L%)
  const exitedInvested = (t: Trade): number => {
    const exitedQty = t.exits && t.exits.length > 0
      ? t.exits.reduce((s: number, e: ExitRecord) => s + e.quantity, 0)
      : (t.exit_quantity ?? 0);
    return t.entry_price * exitedQty;
  };

  const totalPL       = realized.reduce((s, t) => s + (t.pl ?? 0) * applyRate(t), 0);
  const totalInvested = realized.reduce((s, t) => s + exitedInvested(t) * applyRate(t), 0);
  const totalPLPct    = totalInvested > 0 ? (totalPL / totalInvested) * 100 : 0;

  const winners = realized.filter(t => (t.pl ?? 0) > 0);
  const losers  = realized.filter(t => (t.pl ?? 0) < 0);
  const winRate = realized.length > 0 ? (winners.length / realized.length) * 100 : 0;

  const avgWin  = winners.length > 0
    ? winners.reduce((s, t) => s + (t.pl ?? 0) * applyRate(t), 0) / winners.length : 0;
  const avgLoss = losers.length > 0
    ? losers.reduce((s, t) => s + (t.pl ?? 0) * applyRate(t), 0) / losers.length : 0;

  // Capital in open = entry_price × remaining_qty (in display currency)
  const openInvested = open.reduce((s, t) => {
    return s + t.entry_price * remainingQty(t) * todayRate;
  }, 0);

  // Unrealised P&L: compute in native currency then convert with today's rate
  const unrealizedPL = open.reduce((s, t) => {
    const stockKey = `${t.stock}:${exchange}`;
    const currentPrice = stockPrices?.[stockKey]?.currentPrice;
    const qty = remainingQty(t);
    if (!currentPrice || !qty) return s;
    return s + (currentPrice - t.entry_price) * qty * todayRate;
  }, 0);

  return { closed, realized, open, totalPL, totalPLPct, winRate, avgWin, avgLoss, openInvested, unrealizedPL, winners, losers };
}

export default function SummaryCards({ trades, currency, exchangeRate, dateRates, stockPrices, exchange, title, compact }: Props) {
  const sym    = currency === 'INR' ? '₹' : '$';
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  const rate   = currency === 'INR' ? exchangeRate ?? 1 : 1;

  const { closed, realized, open, totalPL, totalPLPct, winRate, avgWin, avgLoss, openInvested, unrealizedPL, winners, losers } =
    calcMetrics(trades, currency, exchange, rate, dateRates, stockPrices);

  const allCards = [
    { label: 'Total Trades',      value: fmt(trades.length, 0, locale),                                                                       color: 'neutral' },
    { label: 'Open Positions',    value: fmt(open.length, 0, locale),                                                                          color: 'neutral' },
    { label: 'Capital in Open',   value: `${sym}${fmt(openInvested, 0, locale)}`,                                                              color: 'neutral' },
    { label: 'Unrealised P/L',    value: `${unrealizedPL >= 0 ? '+' : '-'}${sym}${fmt(Math.abs(unrealizedPL), 2, locale)}`,                   color: unrealizedPL > 0 ? 'green' : unrealizedPL < 0 ? 'red' : 'neutral' },
    { label: 'Realised P/L',      value: `${totalPL >= 0 ? '+' : '-'}${sym}${fmt(Math.abs(totalPL), 2, locale)}`,                             color: totalPL > 0 ? 'green' : totalPL < 0 ? 'red' : 'neutral' },
    { label: 'P/L %',             value: `${totalPLPct >= 0 ? '+' : ''}${totalPLPct.toFixed(2)}%`,                                            color: totalPLPct > 0 ? 'green' : totalPLPct < 0 ? 'red' : 'neutral' },
    { label: 'Win Rate',          value: realized.length ? `${winRate.toFixed(1)}%` : '—',                                                    color: winRate >= 50 ? 'green' : 'red' },
    { label: `Avg Win (${sym})`,  value: winners.length ? `+${sym}${fmt(avgWin, 2, locale)}` : '—',                                           color: 'green' },
    { label: `Avg Loss (${sym})`, value: losers.length  ? `-${sym}${fmt(Math.abs(avgLoss), 2, locale)}` : '—',                                color: losers.length ? 'red' : 'neutral' },
  ];

  const compactCards = [
    allCards[0], // Total Trades
    allCards[1], // Open Positions
    allCards[3], // Unrealised P/L
    allCards[4], // Realised P/L
    allCards[5], // P/L %
    allCards[6], // Win Rate
  ];

  const cards = compact ? compactCards : allCards;

  return (
    <div className={compact ? 'summary-section' : undefined}>
      {title && <div className="summary-section-title">{title}</div>}
      <div className={compact ? 'summary-grid summary-grid--compact' : 'summary-grid'}>
        {cards.map(c => (
          <div key={c.label} className="summary-card">
            <div className="label">{c.label}</div>
            <div className={`value ${c.color}`}>{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
