import { Trade, StockPrice } from '../types';

interface Props {
  trade: Trade;
  currency: 'INR' | 'USD';
  stockPrices?: Record<string, StockPrice>;
  exchange: 'US' | 'IN';
  onClose: () => void;
  onEdit: (trade: Trade) => void;
}

function fmt(n: number | undefined | null, decimals = 2, locale = 'en-IN'): string {
  if (n == null) return '—';
  return n.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y.slice(2)}`;
}

function remainingQty(t: Trade): number {
  const exited = t.exits && t.exits.length > 0
    ? t.exits.reduce((s, e) => s + e.quantity, 0)
    : (t.exit_quantity ?? 0);
  return Math.max(0, t.entry_quantity - exited);
}

export default function TradeDetailModal({ trade, currency, stockPrices, exchange, onClose, onEdit }: Props) {
  const sym    = currency === 'INR' ? '₹' : '$';
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';

  const stockKey     = `${trade.stock}:${exchange}`;
  const currentPrice = stockPrices?.[stockKey]?.currentPrice;
  const remaining    = remainingQty(trade);
  const isOpen       = trade.status === 'Open' || trade.status === 'Partial';

  const unrealizedPL    = isOpen && currentPrice != null ? (currentPrice - trade.entry_price) * remaining : null;
  const unrealizedPLPct = isOpen && currentPrice != null ? ((currentPrice - trade.entry_price) / trade.entry_price) * 100 : null;

  const exits = trade.exits && trade.exits.length > 0
    ? trade.exits
    : trade.exit_price != null && trade.exit_quantity != null
      ? [{ date: trade.exit_date ?? '', quantity: trade.exit_quantity, price: trade.exit_price, reason: trade.reason_for_exit, emotions: trade.emotions }]
      : [];

  const plColor  = (v: number | null | undefined) => v == null ? '#1e293b' : v > 0 ? '#16a34a' : v < 0 ? '#dc2626' : '#1e293b';
  const badgeStyle = (status?: string): React.CSSProperties => ({
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 600,
    background: status === 'Open' ? '#dcfce7' : status === 'Partial' ? '#fef9c3' : '#f1f5f9',
    color:      status === 'Open' ? '#16a34a' : status === 'Partial' ? '#854d0e' : '#475569',
  });

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0 }}>{trade.stock}</h2>
            <span style={badgeStyle(trade.status)}>{trade.status}</span>
            {trade.trade_type && (
              <span style={{ fontSize: 11, color: '#94a3b8', textTransform: 'capitalize' }}>{trade.trade_type}</span>
            )}
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {/* Key metrics row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Entry Price', value: `${sym}${fmt(trade.entry_price, 2, locale)}` },
              { label: 'Qty Remaining', value: fmt(remaining, remaining % 1 === 0 ? 0 : 6, locale) },
              { label: 'Invested', value: `${sym}${fmt(trade.invested, 0, locale)}` },
              { label: 'Realised P/L', value: trade.pl != null ? `${trade.pl >= 0 ? '+' : ''}${sym}${fmt(Math.abs(trade.pl), 2, locale)}` : '—', color: plColor(trade.pl) },
              { label: 'P/L %', value: trade.pl_percentage != null ? `${trade.pl_percentage >= 0 ? '+' : ''}${fmt(trade.pl_percentage, 2, locale)}%` : '—', color: plColor(trade.pl_percentage) },
              { label: 'Days in Trade', value: trade.days_in_trade ?? '—' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: color ?? '#1e293b' }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Current price / unrealized — only for open */}
          {isOpen && currentPrice != null && (
            <div style={{ background: '#f0f9ff', borderRadius: 8, padding: '10px 14px', marginBottom: 20, display: 'flex', gap: 24 }}>
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Current Price</div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{sym}{fmt(currentPrice, 2, locale)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Unrealised P/L</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: plColor(unrealizedPL) }}>
                  {unrealizedPL! >= 0 ? '+' : '-'}{sym}{fmt(Math.abs(unrealizedPL!), 2, locale)}
                  {unrealizedPLPct != null && <span style={{ fontSize: 12, marginLeft: 6 }}>({unrealizedPLPct >= 0 ? '+' : ''}{fmt(unrealizedPLPct, 2, locale)}%)</span>}
                </div>
              </div>
            </div>
          )}

          {/* Entry details */}
          <div className="form-section">
            <div className="form-section-title">Entry</div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
              <div><span style={labelStyle}>Date</span> {fmtDate(trade.entry_date)}</div>
              <div><span style={labelStyle}>Qty</span> {fmt(trade.entry_quantity, trade.entry_quantity % 1 === 0 ? 0 : 6, locale)}</div>
              <div><span style={labelStyle}>Price</span> {sym}{fmt(trade.entry_price, 2, locale)}</div>
              {trade.pf_percentage != null && (
                <div><span style={labelStyle}>PF %</span> {fmt(trade.pf_percentage, 2, locale)}%</div>
              )}
            </div>
            {trade.reason_for_entry && (
              <div style={{ marginTop: 8, fontSize: 13 }}>
                <span style={labelStyle}>Reason</span>
                <span style={{ color: '#334155' }}>{trade.reason_for_entry}</span>
              </div>
            )}
          </div>

          {/* Exit records */}
          {exits.length > 0 && (
            <div className="form-section">
              <div className="form-section-title">Exits</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f1f5f9' }}>
                    {['#', 'Date', 'Qty', 'Price', 'P/L', 'Reason', 'Emotions'].map(h => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {exits.map((ex, i) => {
                    const pl = (ex.price - trade.entry_price) * ex.quantity;
                    return (
                      <tr key={i} style={{ borderTop: '1px solid #e2e8f0' }}>
                        <td style={td}>{i + 1}</td>
                        <td style={td}>{fmtDate(ex.date)}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{ex.quantity}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{sym}{fmt(ex.price, 2, locale)}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: plColor(pl) }}>
                          {pl >= 0 ? '+' : ''}{sym}{fmt(Math.abs(pl), 2, locale)}
                        </td>
                        <td style={{ ...td, color: '#64748b' }}>{ex.reason || '—'}</td>
                        <td style={{ ...td, color: '#64748b' }}>{ex.emotions || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Notes */}
          {(trade.reason_for_exit || trade.emotions) && (
            <div className="form-section">
              <div className="form-section-title">Notes</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                {trade.reason_for_exit && (
                  <div><span style={labelStyle}>Exit Reason</span> <span style={{ color: '#334155' }}>{trade.reason_for_exit}</span></div>
                )}
                {trade.emotions && (
                  <div><span style={labelStyle}>Emotions</span> <span style={{ color: '#334155' }}>{trade.emotions}</span></div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={() => { onClose(); onEdit(trade); }}>Edit</button>
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { fontWeight: 600, color: '#94a3b8', marginRight: 6, textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.04em' };
const th: React.CSSProperties = { padding: '5px 8px', textAlign: 'left', fontWeight: 600, color: '#475569' };
const td: React.CSSProperties = { padding: '5px 8px' };
