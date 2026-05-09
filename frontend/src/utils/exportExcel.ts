import * as XLSX from 'xlsx';
import { Trade } from '../types';

function tradeToRow(t: Trade, sym: string, locale: string, rate = 1) {
  const m = (n: number | null | undefined) =>
    n != null ? parseFloat((n * rate).toFixed(2)) : '';

  return {
    '#': t.id ?? '',
    Stock: t.stock,
    'Entry Date': t.entry_date,
    'Exit Date': t.exit_date || '',
    Status: t.status || '',
    'Days in Trade': t.days_in_trade || '',
    'Entry Qty': t.entry_quantity,
    'Exit Qty': t.exit_quantity ?? '',
    [`Entry Price (${sym})`]: m(t.entry_price),
    [`Exit Price (${sym})`]: m(t.exit_price),
    [`Invested (${sym})`]: m(t.invested),
    'PF %': t.pf_percentage != null ? parseFloat(t.pf_percentage.toFixed(2)) : '',
    'Reason for Entry': t.reason_for_entry,
    'Reason for Exit': t.reason_for_exit,
    [`P/L (${sym})`]: m(t.pl),
    'P/L %': t.pl_percentage != null ? parseFloat(t.pl_percentage.toFixed(2)) : '',
    Emotions: t.emotions,
    // suppress unused locale (kept for potential future sheet-level formatting)
    _locale: undefined as unknown as string,
  };
}

function makeSheet(trades: Trade[], sym: string, locale: string, rate = 1) {
  const rows = trades.map(t => {
    const row = tradeToRow(t, sym, locale, rate);
    // remove internal locale field
    const { _locale: _, ...clean } = row;
    return clean;
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  // auto-size columns (approximate)
  const cols = Object.keys(rows[0] ?? {});
  ws['!cols'] = cols.map(k => ({ wch: Math.max(k.length + 2, 12) }));
  return ws;
}

export function exportToExcel(
  indiaTrades: Trade[],
  usTrades: Trade[],
  usdToInr: number,
) {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, makeSheet(indiaTrades, '₹', 'en-IN'), 'India Trades');
  XLSX.utils.book_append_sheet(wb, makeSheet(usTrades, '$', 'en-US'), 'US Trades (USD)');

  if (usdToInr > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      makeSheet(usTrades, '₹', 'en-IN', usdToInr),
      'US Trades (INR)',
    );
  }

  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `stock-journal-${date}.xlsx`);
}
