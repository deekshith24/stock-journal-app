import { useState } from 'react';
import { Trade, StockPrice } from '../types';

interface Props {
  trades: Trade[];
  currency: 'INR' | 'USD';
  exchange: 'US' | 'IN';
  exchangeRate?: number;
  dateRates?: Record<string, number>;
  stockPrices?: Record<string, StockPrice>;
  onEdit: (trade: Trade) => void;
  onDelete: (trade: Trade) => void;
  onClose: (trade: Trade) => void;
  onCloseGroup: (stock: string, trades: Trade[]) => void;
  onAddPosition: (stock: string) => void;
  onView: (trade: Trade) => void;
  onUpdateGroupSL: (trades: Trade[], stopLoss: number | null) => Promise<void>;
  onConvertToPositional: (trade: Trade) => Promise<void>;
}

function remainingQty(t: Trade): number {
  const exited = t.exits && t.exits.length > 0
    ? t.exits.reduce((s, e) => s + e.quantity, 0)
    : (t.exit_quantity ?? 0);
  return Math.max(0, t.entry_quantity - exited);
}

function fmt(n: number | undefined, decimals = 2, locale = 'en-IN'): string {
  if (n == null) return '—';
  return n.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtQty(n: number | undefined, locale = 'en-IN'): string {
  if (n == null) return '—';
  if (Number.isInteger(n)) return n.toLocaleString(locale, { maximumFractionDigits: 0 });
  return n.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 6 });
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y.slice(2)}`;
}

function rowClass(trade: Trade): string {
  if (trade.status === 'Open' || trade.status === 'Partial') return 'row-open';
  if ((trade.pl ?? 0) > 0) return 'row-profit';
  if ((trade.pl ?? 0) < 0) return 'row-loss';
  return '';
}

function plClass(pl: number | undefined | null): string {
  if (pl == null || pl === 0) return 'pl-zero';
  return pl > 0 ? 'pl-positive' : 'pl-negative';
}

type RenderItem =
  | { kind: 'group'; stock: string; trades: Trade[] }
  | { kind: 'trade'; trade: Trade; isChild: boolean; idx: number };

function parseDays(d: string | undefined): number {
  if (!d) return 0;
  return parseInt(d, 10) || 0;
}

export default function TradeTable({ trades, currency, exchange, exchangeRate, dateRates, stockPrices, onEdit, onDelete, onClose, onCloseGroup, onAddPosition, onView, onUpdateGroupSL, onConvertToPositional }: Props) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set());
  const [editingGroupSL, setEditingGroupSL] = useState<{ stock: string; value: string } | null>(null);
  const [savingSL, setSavingSL] = useState(false);

  const toggleCol = (col: string) =>
    setExpandedCols(prev => { const n = new Set(prev); n.has(col) ? n.delete(col) : n.add(col); return n; });

  const sym    = currency === 'INR' ? '₹' : '$';
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  const rate   = exchangeRate ?? 1;
  const todayRate = currency === 'INR' && exchange === 'US' ? rate : 1;

  if (trades.length === 0) {
    return (
      <div className="table-wrapper">
        <div className="empty-state">
          <div className="icon">📊</div>
          <p>No trades found. Add your first trade to get started.</p>
        </div>
      </div>
    );
  }

  // Group open/partial trades by stock — only stocks with 2+ concurrent positions get a parent row
  const openPartialMap = new Map<string, Trade[]>();
  const standalone: Trade[] = [];

  for (const t of trades) {
    if (t.status === 'Open' || t.status === 'Partial') {
      const bucket = openPartialMap.get(t.stock) ?? [];
      bucket.push(t);
      openPartialMap.set(t.stock, bucket);
    } else {
      standalone.push(t);
    }
  }

  const renderItems: RenderItem[] = [];
  let rowIdx = 0;

  for (const [stock, bucket] of openPartialMap) {
    if (bucket.length > 1) {
      renderItems.push({ kind: 'group', stock, trades: bucket });
      if (expandedGroups.has(stock)) {
        for (const t of bucket) {
          renderItems.push({ kind: 'trade', trade: t, isChild: true, idx: ++rowIdx });
        }
      }
    } else {
      renderItems.push({ kind: 'trade', trade: bucket[0], isChild: false, idx: ++rowIdx });
    }
  }
  for (const t of standalone) {
    renderItems.push({ kind: 'trade', trade: t, isChild: false, idx: ++rowIdx });
  }

  const toggleGroup = (stock: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(stock) ? next.delete(stock) : next.add(stock);
      return next;
    });
  };

  const renderTradeCells = (t: Trade, isChild: boolean, idx: number) => {
    const rateForTrade = currency === 'INR' && exchange === 'US' ? (dateRates?.[t.entry_date] ?? exchangeRate ?? 1) : 1;
    const stockKey    = `${t.stock}:${exchange}`;
    const currentPrice = stockPrices?.[stockKey]?.currentPrice;
    const isOpenOrPartial = t.status === 'Open' || t.status === 'Partial';
    const isOverdueSwing  = isOpenOrPartial && (t.trade_type === 'swing' || !t.trade_type) && parseDays(t.days_in_trade) > 9;
    const unrealizedPL = isOpenOrPartial && currentPrice != null
      ? (currentPrice - t.entry_price) * remainingQty(t) * todayRate
      : null;
    const unrealizedPLPct = isOpenOrPartial && currentPrice != null
      ? ((currentPrice - t.entry_price) / t.entry_price) * 100
      : null;
    const entryPrice = t.entry_price * rateForTrade;
    const exitPrice  = t.exit_price != null ? t.exit_price * rateForTrade : null;
    const invested   = t.invested != null ? t.invested * rateForTrade : undefined;
    const pl         = t.pl != null ? t.pl * rateForTrade : undefined;

    return (
      <tr key={t.id} className={rowClass(t)}>
        <td style={{ color: '#9aa3af', fontSize: 11 }}>{idx}</td>
        <td>
          {isChild && <span style={{ display: 'inline-block', width: 14, color: '#c1c8d0', fontSize: 10 }}>└</span>}
          <span
            className="stock-name"
            style={{ ...(isChild ? { fontSize: 12 } : {}), cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}
            onClick={() => onView(t)}
            title="View details"
          >{t.stock}</span>
          {isOverdueSwing && (
            <span title={`Swing trade held ${t.days_in_trade} — consider moving to Positional`} style={{ marginLeft: 5, fontSize: 9, background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', borderRadius: 3, padding: '1px 4px', fontWeight: 700, verticalAlign: 'middle' }}>
              ⏱ {t.days_in_trade}
            </span>
          )}
        </td>
        <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
          {t.exit_date ? `${fmtDate(t.entry_date)} – ${fmtDate(t.exit_date)}` : fmtDate(t.entry_date)}
        </td>
        <td><span className={`badge badge-${t.status?.toLowerCase()}`}>{t.status}</span></td>
        <td className="text-center">{t.days_in_trade}</td>
        <td className="text-right">{fmtQty(remainingQty(t), locale)}</td>
        <td className="text-right">
          <div><span className="mask-price">{fmt(entryPrice, 2, locale)}</span></div>
          {exitPrice != null && <div style={{ fontSize: 11, color: '#64748b' }}>→ <span className="mask-price">{fmt(exitPrice, 2, locale)}</span></div>}
          {t.stop_loss != null && isOpenOrPartial && (() => {
            const sl = t.stop_loss * rateForTrade;
            const isProtected = t.stop_loss >= t.entry_price;
            const slPct = ((t.stop_loss - t.entry_price) / t.entry_price) * 100;
            return (
              <div style={{ fontSize: 10, marginTop: 1, color: isProtected ? '#16a34a' : '#b45309' }}>
                {isProtected ? '✓' : '⊘'} SL <span className="mask-price">{fmt(sl, 2, locale)}</span>
                <span style={{ marginLeft: 3, opacity: 0.85 }}>({slPct >= 0 ? '+' : ''}{fmt(slPct, 1, locale)}%)</span>
              </div>
            );
          })()}
        </td>
        <td className="text-right"><span className="mask-price">{fmt(invested, 0, locale)}</span></td>
        <td className="text-right">{t.pf_percentage != null ? `${fmt(t.pf_percentage, 2, locale)}%` : '—'}</td>
        <td>
          {t.reason_for_entry
            ? expandedCols.has('entryReason')
              ? <div style={{ whiteSpace: 'normal', lineHeight: 1.4, minWidth: 200 }}>{t.reason_for_entry}</div>
              : <div className="text-truncate" title={t.reason_for_entry}>{t.reason_for_entry}</div>
            : <span style={{ color: '#c1c8d0' }}>—</span>}
        </td>
        <td>
          {t.reason_for_exit
            ? expandedCols.has('exitReason')
              ? <div style={{ whiteSpace: 'normal', lineHeight: 1.4, minWidth: 200 }}>{t.reason_for_exit}</div>
              : <div className="text-truncate" title={t.reason_for_exit}>{t.reason_for_exit}</div>
            : <span style={{ color: '#c1c8d0' }}>—</span>}
        </td>
        <td className={`text-right ${plClass(pl)}`}>
          {pl != null && pl !== 0
            ? <div>
                <div><span className="mask-price">{pl > 0 ? '+' : ''}{fmt(pl, 2, locale)}</span></div>
                {t.pl_percentage != null && t.pl_percentage !== 0 &&
                  <div style={{ fontSize: 11, opacity: 0.85 }}>{t.pl_percentage > 0 ? '+' : ''}{fmt(t.pl_percentage, 2, locale)}%</div>}
              </div>
            : '—'}
        </td>
        <td className={`text-right ${plClass(unrealizedPL)}`}>
          {unrealizedPL != null
            ? <div>
                <div><span className="mask-price">{unrealizedPL >= 0 ? '+' : '-'}{sym}{fmt(Math.abs(unrealizedPL), 2, locale)}</span></div>
                <div style={{ fontSize: 11, opacity: 0.85 }}>{unrealizedPLPct! >= 0 ? '+' : ''}{fmt(unrealizedPLPct!, 2, locale)}%</div>
              </div>
            : '—'}
        </td>
        <td>
          {t.emotions
            ? expandedCols.has('emotions')
              ? <div style={{ whiteSpace: 'normal', lineHeight: 1.4, minWidth: 180 }}>{t.emotions}</div>
              : <div className="text-truncate" style={{ maxWidth: 150 }} title={t.emotions}>{t.emotions}</div>
            : <span style={{ color: '#c1c8d0' }}>—</span>}
        </td>
        <td>
          <div className="actions-cell">
            {!isChild && (t.status === 'Open' || t.status === 'Partial') && (
              <button className="btn-icon btn-close" onClick={() => onClose(t)} title="Close position">✓</button>
            )}
            {!isChild && (t.status === 'Open' || t.status === 'Partial') && (
              <button className="btn-icon" onClick={() => onAddPosition(t.stock)} title="Add position" style={{ color: '#2563eb', fontWeight: 700 }}>+</button>
            )}
            {isOverdueSwing && !isChild && (
              <button
                className="btn-icon"
                title="Move to Positional"
                style={{ color: '#7c3aed', fontSize: 10, fontWeight: 700 }}
                onClick={() => onConvertToPositional(t)}
              >→ Pos</button>
            )}
            {!isChild && <button className="btn-icon" onClick={() => onEdit(t)} title="Edit">✏️</button>}
            {isChild && <button className="btn-icon" onClick={() => onEdit(t)} title="Edit">✏️</button>}
            <button className="btn-icon" onClick={() => onDelete(t)} title="Delete" style={{ color: '#dc2626' }}>🗑️</button>
          </div>
        </td>
      </tr>
    );
  };

  const renderGroupRow = (stock: string, bucket: Trade[]) => {
    const isExpanded = expandedGroups.has(stock);
    const stockKey   = `${stock}:${exchange}`;
    const currentPrice = stockPrices?.[stockKey]?.currentPrice;

    const totalRemaining = bucket.reduce((s, t) => s + remainingQty(t), 0);
    const totalRemainingCost = bucket.reduce((s, t) => s + t.entry_price * remainingQty(t), 0);
    const avgEntryPrice = totalRemaining > 0 ? totalRemainingCost / totalRemaining : 0;
    const totalInvested = totalRemainingCost * todayRate;
    const unrealizedPL  = currentPrice != null
      ? bucket.reduce((s, t) => s + (currentPrice - t.entry_price) * remainingQty(t) * todayRate, 0)
      : null;
    const unrealizedPLPct = unrealizedPL != null && totalInvested > 0 ? (unrealizedPL / totalInvested) * 100 : null;
    const realizedPL = bucket.reduce((s, t) => s + (t.pl ?? 0) * todayRate, 0);
    const realizedInvested = bucket.reduce((s, t) => {
      const exitedQty = t.exits && t.exits.length > 0
        ? t.exits.reduce((sum, e) => sum + e.quantity, 0)
        : (t.exit_quantity ?? 0);
      return s + t.entry_price * exitedQty * todayRate;
    }, 0);
    const realizedPLPct = realizedInvested > 0 ? (realizedPL / realizedInvested) * 100 : null;
    const anyPartial = bucket.some(t => t.status === 'Partial');
    const dates = bucket.map(t => t.entry_date).sort();
    const dateLabel = `${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}`;

    // Show group SL only when all entries share the same SL value
    const slValues = bucket.map(t => t.stop_loss ?? null);
    const groupSL = slValues.every(v => v === slValues[0]) ? slValues[0] : null;
    const slIsProtected = groupSL != null && groupSL >= avgEntryPrice;

    return (
      <tr key={`group-${stock}`} className="row-open row-group" onClick={() => toggleGroup(stock)} style={{ cursor: 'pointer' }}>
        <td style={{ color: '#9aa3af', fontSize: 11 }}>—</td>
        <td>
          <span style={{ marginRight: 6, fontSize: 11, color: '#6c757d' }}>{isExpanded ? '▼' : '▶'}</span>
          <span className="stock-name">{stock}</span>
          <span style={{ marginLeft: 6, fontSize: 10, background: '#dbeafe', color: '#1e40af', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>
            {bucket.length} entries
          </span>
        </td>
        <td style={{ whiteSpace: 'nowrap', fontSize: 11, color: '#6c757d' }}>{dateLabel}</td>
        <td>
          <span className={`badge ${anyPartial ? 'badge-partial' : 'badge-open'}`}>
            {anyPartial ? 'Partial' : 'Open'}
          </span>
        </td>
        <td className="text-center">—</td>
        <td className="text-right" style={{ fontWeight: 600 }}>{fmtQty(totalRemaining, locale)}</td>
        <td className="text-right" style={{ fontSize: 11, color: '#6c757d' }}>
          <div>avg <span className="mask-price">{fmt(avgEntryPrice * todayRate, 2, locale)}</span></div>
          {groupSL != null && (
            <div style={{ fontSize: 10, marginTop: 1, color: slIsProtected ? '#16a34a' : '#b45309' }}>
              {slIsProtected ? '✓' : '⊘'} SL <span className="mask-price">{fmt(groupSL * todayRate, 2, locale)}</span>
              {avgEntryPrice > 0 && (
                <span style={{ marginLeft: 3, opacity: 0.85 }}>
                  ({(() => { const p = ((groupSL - avgEntryPrice) / avgEntryPrice) * 100; return `${p >= 0 ? '+' : ''}${fmt(p, 1, locale)}`; })()}%)
                </span>
              )}
            </div>
          )}
        </td>
        <td className="text-right" style={{ fontWeight: 600 }}><span className="mask-price">{fmt(totalInvested, 0, locale)}</span></td>
        <td>—</td>
        <td>—</td>
        <td>—</td>
        <td className={`text-right ${plClass(realizedPL || null)}`}>
          {realizedPL !== 0
            ? <div>
                <div><span className="mask-price">{realizedPL >= 0 ? '+' : ''}{fmt(realizedPL, 2, locale)}</span></div>
                {realizedPLPct != null && <div style={{ fontSize: 11, opacity: 0.85 }}>{realizedPLPct >= 0 ? '+' : ''}{fmt(realizedPLPct, 2, locale)}%</div>}
              </div>
            : '—'}
        </td>
        <td className={`text-right ${plClass(unrealizedPL)}`}>
          {unrealizedPL != null
            ? <div>
                <div><span className="mask-price">{unrealizedPL >= 0 ? '+' : '-'}{sym}{fmt(Math.abs(unrealizedPL), 2, locale)}</span></div>
                {unrealizedPLPct != null && <div style={{ fontSize: 11, opacity: 0.85 }}>{unrealizedPLPct >= 0 ? '+' : ''}{fmt(unrealizedPLPct, 2, locale)}%</div>}
              </div>
            : '—'}
        </td>
        <td>—</td>
        <td><div className="actions-cell">
          <button className="btn-icon btn-close" onClick={e => { e.stopPropagation(); onCloseGroup(stock, bucket); }} title="Close position (FIFO)">✓</button>
          <button className="btn-icon" onClick={e => { e.stopPropagation(); onAddPosition(stock); }} title="Add position" style={{ color: '#2563eb', fontWeight: 700 }}>+</button>
          {editingGroupSL?.stock === stock ? (
            <span onClick={e => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <input
                type="number" min="0" step="0.01"
                value={editingGroupSL.value}
                onChange={e => setEditingGroupSL({ stock, value: e.target.value })}
                placeholder="SL price"
                autoFocus
                style={{ width: 72, fontSize: 11, padding: '2px 4px', border: '1px solid #cbd5e1', borderRadius: 4 }}
              />
              <button
                className="btn-icon" title="Save SL" disabled={savingSL}
                style={{ color: '#16a34a', fontWeight: 700 }}
                onClick={async e => {
                  e.stopPropagation();
                  setSavingSL(true);
                  const sl = editingGroupSL.value ? parseFloat(editingGroupSL.value) : null;
                  await onUpdateGroupSL(bucket, sl);
                  setEditingGroupSL(null);
                  setSavingSL(false);
                }}>✓</button>
              <button className="btn-icon" title="Cancel" style={{ color: '#9ca3af' }} onClick={e => { e.stopPropagation(); setEditingGroupSL(null); }}>✕</button>
            </span>
          ) : (
            <button
              className="btn-icon"
              title="Set Stop Loss for all entries"
              style={{ color: '#92400e', fontSize: 11, fontWeight: 600 }}
              onClick={e => {
                e.stopPropagation();
                const currentSL = bucket[0]?.stop_loss;
                setEditingGroupSL({ stock, value: currentSL != null ? String(currentSL) : '' });
              }}>⊘ SL</button>
          )}
        </div></td>
      </tr>
    );
  };

  return (
    <div className="table-wrapper">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Stock</th>
              <th>Date</th>
              <th>Status</th>
              <th>Days</th>
              <th>Qty</th>
              <th>Price ({sym})</th>
              <th>Invested ({sym})</th>
              <th>PF %</th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleCol('entryReason')} title="Click to expand/collapse">
                Reason for Entry {expandedCols.has('entryReason') ? '⊖' : '⊕'}
              </th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleCol('exitReason')} title="Click to expand/collapse">
                Reason for Exit {expandedCols.has('exitReason') ? '⊖' : '⊕'}
              </th>
              <th>P/L ({sym})</th>
              <th>Unreal. P/L ({sym})</th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleCol('emotions')} title="Click to expand/collapse">
                Emotions {expandedCols.has('emotions') ? '⊖' : '⊕'}
              </th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {renderItems.map(item =>
              item.kind === 'group'
                ? renderGroupRow(item.stock, item.trades)
                : renderTradeCells(item.trade, item.isChild, item.idx)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
