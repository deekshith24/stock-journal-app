import * as XLSX from 'xlsx';
import { Trade, StockPrice } from '../types';
import { marketModeFromTrades } from './marketMode';
import { remainingQty, isStalledTrade, getTradeComments, parseDays } from './tradeComments';

function tradeToRow(t: Trade, sym: string, rate = 1) {
  const m = (n: number | null | undefined) =>
    n != null ? parseFloat((n * rate).toFixed(4)) : '';

  return {
    'ID': t.id ?? '',
    'Stock': t.stock,
    'Trade Type': t.trade_type ?? 'swing',
    'Entry Date': t.entry_date,
    'Exit Date': t.exit_date || '',
    'Status': t.status || '',
    'Days in Trade': t.days_in_trade || '',
    'Entry Qty': t.entry_quantity,
    'Exit Qty': t.exit_quantity ?? '',
    [`Entry Price (${sym})`]: m(t.entry_price),
    [`Exit Price (${sym})`]: m(t.exit_price),
    [`Stop Loss (${sym})`]: m(t.stop_loss),
    [`Invested (${sym})`]: m(t.invested),
    'PF %': t.pf_percentage != null ? parseFloat(t.pf_percentage.toFixed(2)) : '',
    'Reason for Entry': t.reason_for_entry,
    'Reason for Exit': t.reason_for_exit,
    [`P/L (${sym})`]: m(t.pl),
    'P/L %': t.pl_percentage != null ? parseFloat(t.pl_percentage.toFixed(2)) : '',
    'Emotions': t.emotions,
    'Created At': t.created_at ?? '',
  };
}

function makeTradeSheet(trades: Trade[], sym: string, rate = 1) {
  const rows = trades.map(t => tradeToRow(t, sym, rate));
  if (rows.length === 0) return XLSX.utils.json_to_sheet([]);
  const ws = XLSX.utils.json_to_sheet(rows);
  const cols = Object.keys(rows[0]);
  ws['!cols'] = cols.map(k => ({ wch: Math.max(k.length + 2, 12) }));
  return ws;
}

interface ExitRow {
  'Trade ID': number | string;
  'Stock': string;
  'Market': string;
  'Exit Date': string;
  'Exit Qty': number;
  'Exit Price': number;
  'Reason for Exit': string;
  'Emotions': string;
}

function makeExitsSheet(indiaTrades: Trade[], usTrades: Trade[]): XLSX.WorkSheet {
  const rows: ExitRow[] = [];

  const addExits = (trades: Trade[], market: string) => {
    for (const t of trades) {
      if (t.exits && t.exits.length > 0) {
        for (const e of t.exits) {
          rows.push({
            'Trade ID': t.id ?? '',
            'Stock': t.stock,
            'Market': market,
            'Exit Date': e.date,
            'Exit Qty': e.quantity,
            'Exit Price': e.price,
            'Reason for Exit': e.reason ?? '',
            'Emotions': e.emotions ?? '',
          });
        }
      } else if (t.exit_price != null && t.exit_quantity != null) {
        rows.push({
          'Trade ID': t.id ?? '',
          'Stock': t.stock,
          'Market': market,
          'Exit Date': t.exit_date ?? '',
          'Exit Qty': t.exit_quantity,
          'Exit Price': t.exit_price,
          'Reason for Exit': t.reason_for_exit ?? '',
          'Emotions': t.emotions ?? '',
        });
      }
    }
  };

  addExits(indiaTrades, 'India');
  addExits(usTrades, 'US');

  if (rows.length === 0) return XLSX.utils.json_to_sheet([]);
  const ws = XLSX.utils.json_to_sheet(rows);
  const cols = Object.keys(rows[0]);
  ws['!cols'] = cols.map(k => ({ wch: Math.max(k.length + 2, 12) }));
  return ws;
}

export function exportToExcel(
  indiaTrades: Trade[],
  usTrades: Trade[],
  usdToInr: number,
) {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, makeTradeSheet(indiaTrades, '₹'), 'India Trades');
  XLSX.utils.book_append_sheet(wb, makeTradeSheet(usTrades, '$'), 'US Trades (USD)');

  if (usdToInr > 0) {
    XLSX.utils.book_append_sheet(wb, makeTradeSheet(usTrades, '₹', usdToInr), 'US Trades (INR)');
  }

  XLSX.utils.book_append_sheet(wb, makeExitsSheet(indiaTrades, usTrades), 'Exit Records');

  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `stock-journal-${date}.xlsx`);
}

export function exportToJSON(
  indiaTrades: Trade[],
  usTrades: Trade[],
  stockPrices?: Record<string, StockPrice>,
) {
  const marketMode = marketModeFromTrades([...indiaTrades, ...usTrades]);

  const enrichTrade = (t: Trade, exchange: 'IN' | 'US') => {
    const stockKey = `${t.stock}:${exchange}`;
    const currentPrice = stockPrices?.[stockKey]?.currentPrice;
    const isOpenOrPartial = t.status === 'Open' || t.status === 'Partial';
    const unrealizedPLPct = isOpenOrPartial && currentPrice != null
      ? ((currentPrice - t.entry_price) / t.entry_price) * 100
      : null;
    const isFullPosition = Math.abs(remainingQty(t) - t.entry_quantity) < 1e-8;
    const isStalled = isStalledTrade(t, currentPrice);
    const isOverdueSwing = isOpenOrPartial && (t.trade_type === 'swing' || !t.trade_type) && parseDays(t.days_in_trade) > 9;
    const comments = getTradeComments(t, unrealizedPLPct, isFullPosition, isStalled, isOverdueSwing, isOpenOrPartial ?? false, marketMode);

    return {
      id: t.id,
      stock: t.stock,
      trade_type: t.trade_type ?? 'swing',
      entry_date: t.entry_date,
      exit_date: t.exit_date,
      entry_quantity: t.entry_quantity,
      exit_quantity: t.exit_quantity,
      entry_price: t.entry_price,
      exit_price: t.exit_price,
      stop_loss: t.stop_loss ?? null,
      reason_for_entry: t.reason_for_entry,
      reason_for_exit: t.reason_for_exit,
      emotions: t.emotions,
      created_at: t.created_at,
      exits: t.exits ?? [],
      status: t.status,
      days_in_trade: t.days_in_trade,
      invested: t.invested,
      pf_percentage: t.pf_percentage,
      pl: t.pl,
      pl_percentage: t.pl_percentage,
      comments: comments.map(c => c.text),
    };
  };

  const payload = {
    exportDate: new Date().toISOString().slice(0, 10),
    version: 1,
    indiaTrades: indiaTrades.map(t => enrichTrade(t, 'IN')),
    usTrades: usTrades.map(t => enrichTrade(t, 'US')),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `stock-journal-${payload.exportDate}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
