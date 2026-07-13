import { useState } from 'react';
import { Trade, StockPrice } from '../types';
import { marketModeFromTrades } from '../utils/marketMode';

interface Props {
  trades: Trade[];
  currency: 'INR' | 'USD';
  exchange: 'US' | 'IN';
  exchangeRate?: number;
  dateRates?: Record<string, number>;
  stockPrices?: Record<string, StockPrice>;
  portfolioSize?: number;
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

type CommentStyle = 'danger' | 'warning' | 'success';

interface TradeComment {
  text: string;
  style: CommentStyle;
}

const COMMENT_STYLES: Record<CommentStyle, { background: string; color: string; border: string }> = {
  danger:  { background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' },
  warning: { background: '#fffbeb', color: '#92400e', border: '1px solid #fcd34d' },
  success: { background: '#dcfce7', color: '#15803d', border: '1px solid #86efac' },
};

function renderComments(comments: TradeComment[]) {
  if (comments.length === 0) return <span style={{ color: '#c1c8d0' }}>—</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {comments.map((c, i) => (
        <span key={i} style={{ fontSize: 11, borderRadius: 3, padding: '2px 6px', fontWeight: 600, whiteSpace: 'nowrap', ...COMMENT_STYLES[c.style] }}>
          {c.text}
        </span>
      ))}
    </div>
  );
}

function getTradeComments(
  t: Trade,
  unrealizedPLPct: number | null,
  isFullPosition: boolean,
  isStalled: boolean,
  isOverdueSwing: boolean,
  isOpenOrPartial: boolean,
  marketMode: 'choppy' | 'bull' | 'neutral',
): TradeComment[] {
  if (!isOpenOrPartial) return [];
  const cs: TradeComment[] = [];

  // Structural / exit signals (danger)
  if (isStalled)      cs.push({ text: 'Exit — stalled 10+ days', style: 'danger' });
  if (isOverdueSwing) cs.push({ text: `Exit swing (${t.days_in_trade}d held)`, style: 'danger' });
  if (t.stop_loss == null) cs.push({ text: '⚠ Set a Stop Loss', style: 'danger' });

  // SL too wide: ideal entry risks 3%, max 5% (under 200 EMA stretch)
  if (t.stop_loss != null && t.entry_price > 0) {
    const slRiskPct = ((t.entry_price - t.stop_loss) / t.entry_price) * 100;
    if (slRiskPct > 5) cs.push({ text: `SL wide (${slRiskPct.toFixed(1)}% risk/share)`, style: 'danger' });
  }

  // Open risk per trade vs portfolio: choppy/neutral limit 1%, bull limit 2%
  // open_risk% = (entry−sl)/entry × pf_percentage
  if (t.stop_loss != null && t.entry_price > 0 && (t.pf_percentage ?? 0) > 0) {
    const slRisk = (t.entry_price - t.stop_loss) / t.entry_price;
    if (slRisk > 0) {
      const openRisk = slRisk * (t.pf_percentage! / 100) * 100;
      const limit = marketMode === 'bull' ? 2 : 1;
      if (openRisk > limit) {
        cs.push({ text: `Open risk ${openRisk.toFixed(1)}% PF (limit ${limit}%)`, style: marketMode === 'bull' ? 'warning' : 'danger' });
      }
    }
  }

  if (unrealizedPLPct != null) {
    const pfPct = t.pf_percentage ?? 0;
    const isLargePosition = pfPct >= 15; // 15%+ PF — moves the needle significantly
    const isSmallPosition = pfPct > 0 && pfPct < 10; // <10% PF — partial won't impact much

    // Move SL to breakeven at 8%+ (more aggressive in choppy — protect open risk)
    if (unrealizedPLPct >= 8) {
      const slProtected = t.stop_loss != null && t.stop_loss >= t.entry_price;
      if (!slProtected) cs.push({ text: 'Move SL to breakeven', style: 'warning' });
    }

    // Booking threshold by market mode: choppy 10%, neutral 12%, bull 15%
    // Large positions (≥15% PF): book at 10% regardless — 10% on big size moves the needle
    const modeThreshold = marketMode === 'choppy' ? 10 : marketMode === 'bull' ? 15 : 12;
    const bookThreshold = isLargePosition ? Math.min(modeThreshold, 10) : modeThreshold;

    if (isFullPosition && unrealizedPLPct >= bookThreshold) {
      // Skip suggestion for small positions below 15% gain — peeling off won't move PF
      if (!isSmallPosition || unrealizedPLPct >= 15) {
        cs.push({ text: `Book 30% (+${unrealizedPLPct.toFixed(1)}%)`, style: 'success' });
      }
    }

    // After partial booking — trail remaining with EMA
    if (!isFullPosition && unrealizedPLPct >= 20) {
      cs.push({ text: 'Trail SL with EMA', style: 'warning' });
    }

    // Target zone: aim for 30–40% gains — plan scale-out
    if (unrealizedPLPct >= 28) {
      cs.push({ text: 'Near 30-40% target — plan exit', style: 'success' });
    }
  }

  return cs;
}

function getGroupComments(
  bucket: Trade[],
  unrealizedPLPct: number | null,
  avgEntryPrice: number,
  isStalledGroup: boolean,
  marketMode: 'choppy' | 'bull' | 'neutral',
): TradeComment[] {
  const cs: TradeComment[] = [];

  if (isStalledGroup) cs.push({ text: 'Exit — stalled 10+ days', style: 'danger' });

  const noSLCount = bucket.filter(t => t.stop_loss == null).length;
  if (noSLCount > 0) {
    cs.push({ text: noSLCount === bucket.length ? '⚠ No Stop Loss set' : `⚠ No SL (${noSLCount} entries)`, style: 'danger' });
  }

  if (unrealizedPLPct != null) {
    // Move SL to breakeven at 8%+
    if (unrealizedPLPct >= 8) {
      const slValues = bucket.map(t => t.stop_loss ?? null);
      const groupSL  = slValues.every(v => v === slValues[0]) ? slValues[0] : null;
      const slProtected = groupSL != null && groupSL >= avgEntryPrice;
      if (!slProtected) cs.push({ text: 'Move SL to breakeven', style: 'warning' });
    }

    const totalPfPct = bucket.reduce((s, t) => s + (t.pf_percentage ?? 0), 0);
    const allFull    = bucket.every(t => Math.abs(remainingQty(t) - t.entry_quantity) < 1e-8);
    const modeThreshold = marketMode === 'choppy' ? 10 : marketMode === 'bull' ? 15 : 12;
    const isLargeGroup  = totalPfPct >= 15;
    const bookThreshold = isLargeGroup ? Math.min(modeThreshold, 10) : modeThreshold;

    if (allFull && unrealizedPLPct >= bookThreshold) {
      cs.push({ text: `Book 30% (+${unrealizedPLPct.toFixed(1)}%)`, style: 'success' });
    }

    if (!allFull && unrealizedPLPct >= 20) {
      cs.push({ text: 'Trail SL with EMA', style: 'warning' });
    }

    if (unrealizedPLPct >= 28) {
      cs.push({ text: 'Near 30-40% target — plan exit', style: 'success' });
    }
  }

  return cs;
}

function isStalledTrade(t: Trade, currentPrice?: number): boolean {
  if (!(t.status === 'Open' || t.status === 'Partial')) return false;
  if (parseDays(t.days_in_trade) <= 10) return false;
  if (currentPrice == null) return false;
  const entry = t.entry_price || 0;
  if (entry <= 0) return false;
  const pctMove = Math.abs((currentPrice - entry) / entry) * 100;
  return currentPrice <= entry || pctMove <= 1;
}

export default function TradeTable({ trades, currency, exchange, exchangeRate, dateRates, stockPrices, portfolioSize, onEdit, onDelete, onClose, onCloseGroup, onAddPosition, onView, onUpdateGroupSL, onConvertToPositional }: Props) {
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
  const marketMode = marketModeFromTrades(trades);

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

  const openPartialMap = new Map<string, Trade[]>();
  const standalone: Trade[] = [];

  for (const t of trades) {
    if ((t.status === 'Open' || t.status === 'Partial') && t.trade_type !== 'intraday_short') {
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
    const stockKey     = `${t.stock}:${exchange}`;
    const currentPrice = stockPrices?.[stockKey]?.currentPrice;
    const isOpenOrPartial = t.status === 'Open' || t.status === 'Partial';
    const isOverdueSwing  = isOpenOrPartial && (t.trade_type === 'swing' || !t.trade_type) && parseDays(t.days_in_trade) > 9;
    const isStalled = isStalledTrade(t, currentPrice);
    const unrealizedPL = isOpenOrPartial && currentPrice != null
      ? (currentPrice - t.entry_price) * remainingQty(t) * todayRate
      : null;
    const unrealizedPLPct = isOpenOrPartial && currentPrice != null
      ? ((currentPrice - t.entry_price) / t.entry_price) * 100
      : null;
    const isFullPosition = Math.abs(remainingQty(t) - t.entry_quantity) < 1e-8;
    const comments = getTradeComments(t, unrealizedPLPct, isFullPosition, isStalled, isOverdueSwing, isOpenOrPartial, marketMode);

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
            style={{
              ...(isChild ? { fontSize: 12 } : {}),
              cursor: 'pointer',
              textDecoration: 'underline',
              textDecorationStyle: 'dotted',
              textUnderlineOffset: 3,
              color: isStalled ? '#dc2626' : undefined,
            }}
            onClick={() => onView(t)}
            title={isStalled ? 'Held more than 10 trading days but not moving up — consider exiting' : 'View details'}
          >{t.stock}</span>
          {isOverdueSwing && (
            <span title={`Swing trade held ${t.days_in_trade} — consider moving to Positional`} style={{ marginLeft: 5, fontSize: 9, background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', borderRadius: 3, padding: '1px 4px', fontWeight: 700, verticalAlign: 'middle' }}>
              ⏱ {t.days_in_trade}
            </span>
          )}
        </td>
        <td style={{ minWidth: 140 }}>{renderComments(comments)}</td>
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
          {t.stop_loss == null && isOpenOrPartial && (
            <div style={{ fontSize: 10, marginTop: 1, color: '#dc2626', fontWeight: 600 }}>⚠ No SL</div>
          )}
        </td>
        <td className="text-right">
          {(() => {
            const initialInvested = invested;
            if (!isOpenOrPartial) {
              return <span className="mask-price">{fmt(initialInvested, 0, locale)}</span>;
            }
            const currentInvested = t.entry_price * remainingQty(t) * rateForTrade;
            const hasPartialExit = Math.abs(remainingQty(t) - t.entry_quantity) > 1e-8;
            if (!hasPartialExit) {
              return <span className="mask-price">{fmt(currentInvested, 0, locale)}</span>;
            }
            return (
              <div>
                <div><span className="mask-price">{fmt(currentInvested, 0, locale)}</span></div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
                  <span className="mask-price">{fmt(initialInvested, 0, locale)}</span>
                </div>
              </div>
            );
          })()}
        </td>
        <td className="text-right">
          {(() => {
            if (t.pf_percentage == null) return '—';
            if (!isOpenOrPartial) return `${fmt(t.pf_percentage, 2, locale)}%`;
            const hasPartialExit = Math.abs(remainingQty(t) - t.entry_quantity) > 1e-8;
            if (!hasPartialExit) return `${fmt(t.pf_percentage, 2, locale)}%`;
            const currentPfPct = portfolioSize && portfolioSize > 0
              ? (t.entry_price * remainingQty(t) / portfolioSize) * 100
              : null;
            return (
              <div>
                <div>{currentPfPct != null ? `${fmt(currentPfPct, 2, locale)}%` : '—'}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{fmt(t.pf_percentage, 2, locale)}%</div>
              </div>
            );
          })()}
        </td>
        <td className="text-right">
          {(() => {
            if (!portfolioSize) return <span style={{ color: '#c1c8d0' }}>—</span>;
            if (isOpenOrPartial) {
              // Primary: current unrealized impact on portfolio (if price available)
              const unrealImpactPct = unrealizedPL != null ? (unrealizedPL / portfolioSize) * 100 : null;
              // Secondary: SL impact (what happens if SL hits)
              const slImpactPct = t.stop_loss != null
                ? ((t.stop_loss - t.entry_price) * remainingQty(t) * todayRate / portfolioSize) * 100
                : null;
              if (unrealImpactPct == null && slImpactPct == null) return <span style={{ color: '#c1c8d0' }}>—</span>;
              return (
                <div>
                  {unrealImpactPct != null && (
                    <span style={{ color: unrealImpactPct > 0 ? '#16a34a' : unrealImpactPct < 0 ? '#dc2626' : '#64748b', fontWeight: 600 }}
                      title="Current unrealized impact on portfolio">
                      {unrealImpactPct >= 0 ? '+' : ''}{fmt(unrealImpactPct, 2, locale)}%
                    </span>
                  )}
                  {slImpactPct != null && (
                    <div style={{ fontSize: 10, marginTop: 1, color: slImpactPct >= 0 ? '#16a34a' : Math.abs(slImpactPct) > 1 ? '#dc2626' : '#b45309', opacity: 0.85 }}
                      title="Portfolio impact if SL hits">
                      SL: {slImpactPct >= 0 ? '+' : ''}{fmt(slImpactPct, 2, locale)}%
                    </div>
                  )}
                </div>
              );
            }
            // Closed: P/L impact on portfolio
            if (pl == null || pl === 0) return <span style={{ color: '#c1c8d0' }}>—</span>;
            const impactPct = (pl / portfolioSize) * 100;
            return (
              <span style={{ color: impactPct > 0 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                {impactPct >= 0 ? '+' : ''}{fmt(impactPct, 2, locale)}%
              </span>
            );
          })()}
        </td>
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
    const isStalledGroup = bucket.some(t => isStalledTrade(t, currentPrice));
    const groupComments = getGroupComments(bucket, unrealizedPLPct, avgEntryPrice, isStalledGroup, marketMode);

    const slValues = bucket.map(t => t.stop_loss ?? null);
    const groupSL = slValues.every(v => v === slValues[0]) ? slValues[0] : null;
    const slIsProtected = groupSL != null && groupSL >= avgEntryPrice;

    return (
      <tr key={`group-${stock}`} className="row-open row-group" onClick={() => toggleGroup(stock)} style={{ cursor: 'pointer' }}>
        <td style={{ color: '#9aa3af', fontSize: 11 }}>—</td>
        <td>
          <span style={{ marginRight: 6, fontSize: 11, color: '#6c757d' }}>{isExpanded ? '▼' : '▶'}</span>
          <span className="stock-name" style={{ color: isStalledGroup ? '#dc2626' : undefined }} title={isStalledGroup ? 'Some entries are stalled for over 10 trading days — consider exiting' : undefined}>
            {stock}
          </span>
          <span style={{ marginLeft: 6, fontSize: 10, background: '#dbeafe', color: '#1e40af', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>
            {bucket.length} entries
          </span>
        </td>
        <td style={{ minWidth: 140 }}>{renderComments(groupComments)}</td>
        <td style={{ whiteSpace: 'nowrap', fontSize: 11, color: '#6c757d' }}>{dateLabel}</td>
        <td>
          <span className={`badge ${anyPartial ? 'badge-partial' : 'badge-open'}`}>
            {anyPartial ? 'Partial' : 'Open'}
          </span>
        </td>
        <td className="text-center">—</td>
        <td className="text-right" style={{ fontWeight: 600 }}>{fmtQty(totalRemaining, locale)}</td>
        <td className="text-right" style={{ fontWeight: 600 }}>
          <div><span className="mask-price">{fmt(avgEntryPrice * todayRate, 2, locale)}</span></div>
          {groupSL != null && (
            <div style={{ fontSize: 10, marginTop: 1, color: slIsProtected ? '#16a34a' : '#b45309', fontWeight: 400 }}>
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
        <td className="text-right">
          {(() => {
            if (!portfolioSize || portfolioSize <= 0) {
              const totalPf = bucket.reduce((s, t) => s + (t.pf_percentage ?? 0), 0);
              return totalPf > 0 ? `${fmt(totalPf, 2, locale)}%` : '—';
            }
            const currentPf = (totalRemainingCost * todayRate / portfolioSize) * 100;
            return currentPf > 0 ? `${fmt(currentPf, 2, locale)}%` : '—';
          })()}
        </td>
        <td className="text-right">
          {(() => {
            if (!portfolioSize) return <span style={{ color: '#c1c8d0' }}>—</span>;
            const unrealImpactPct = unrealizedPL != null ? (unrealizedPL / portfolioSize) * 100 : null;
            const hasSL = bucket.some(t => t.stop_loss != null);
            const slImpact = hasSL ? bucket.reduce((s, t) => {
              if (t.stop_loss == null) return s;
              return s + (t.stop_loss - t.entry_price) * remainingQty(t) * todayRate;
            }, 0) : null;
            const slImpactPct = slImpact != null ? (slImpact / portfolioSize) * 100 : null;
            if (unrealImpactPct == null && slImpactPct == null) return <span style={{ color: '#c1c8d0' }}>—</span>;
            return (
              <div>
                {unrealImpactPct != null && (
                  <span style={{ color: unrealImpactPct > 0 ? '#16a34a' : unrealImpactPct < 0 ? '#dc2626' : '#64748b', fontWeight: 600 }}
                    title="Current unrealized impact on portfolio">
                    {unrealImpactPct >= 0 ? '+' : ''}{fmt(unrealImpactPct, 2, locale)}%
                  </span>
                )}
                {slImpactPct != null && (
                  <div style={{ fontSize: 10, marginTop: 1, color: slImpactPct >= 0 ? '#16a34a' : Math.abs(slImpactPct) > 1 ? '#dc2626' : '#b45309', opacity: 0.85 }}
                    title="Portfolio impact if SL hits">
                    SL: {slImpactPct >= 0 ? '+' : ''}{fmt(slImpactPct, 2, locale)}%
                  </div>
                )}
              </div>
            );
          })()}
        </td>
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
              <th>Comment</th>
              <th>Date</th>
              <th>Status</th>
              <th>Days</th>
              <th>Qty</th>
              <th>Price ({sym})</th>
              <th>Invested ({sym})</th>
              <th>PF %</th>
              <th title="Open: SL impact on portfolio. Closed: realized P/L impact on portfolio.">Impact %</th>
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
