import { useState } from 'react';
import { Trade, ExitRecord } from '../types';

export interface GroupExit {
  tradeId: number;
  exit: ExitRecord;
}

interface Props {
  stock: string;
  trades: Trade[];
  currency: 'INR' | 'USD';
  exitReasonSuggestions: string[];
  emotionSuggestions: string[];
  onSave: (exits: GroupExit[]) => Promise<void>;
  onClose: () => void;
}

function remainingQty(t: Trade): number {
  const exited = t.exits && t.exits.length > 0
    ? t.exits.reduce((s, e) => s + e.quantity, 0)
    : (t.exit_quantity ?? 0);
  return Math.max(0, t.entry_quantity - exited);
}

function fmtDate(d: string): string {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y.slice(2)}`;
}

export default function GroupCloseModal({ stock, trades, currency, exitReasonSuggestions, emotionSuggestions, onSave, onClose }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const sym = currency === 'INR' ? '₹' : '$';
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';

  // Sort oldest first for FIFO — use id as tiebreaker when same date
  const sorted = [...trades]
    .filter(t => t.status === 'Open' || t.status === 'Partial')
    .sort((a, b) => {
      const dateCmp = a.entry_date.localeCompare(b.entry_date);
      return dateCmp !== 0 ? dateCmp : (a.id ?? 0) - (b.id ?? 0);
    });

  const totalRemaining = sorted.reduce((s, t) => s + remainingQty(t), 0);

  const [exitDate, setExitDate] = useState(today);
  const [exitQty, setExitQty] = useState<number | ''>(totalRemaining);
  const [exitPrice, setExitPrice] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const [emotions, setEmotions] = useState('');
  const [saving, setSaving] = useState(false);

  // Compute FIFO distribution for preview
  const distribution = (() => {
    if (exitQty === '' || (exitQty as number) <= 0) return [];
    const results: { trade: Trade; qty: number }[] = [];
    let left = exitQty as number;
    for (const t of sorted) {
      if (left <= 0) break;
      const rem = remainingQty(t);
      const qty = Math.min(left, rem);
      results.push({ trade: t, qty });
      left = Math.round((left - qty) * 1e10) / 1e10;
    }
    return results;
  })();

  const thisPL = exitPrice !== '' && distribution.length > 0
    ? distribution.reduce((s, { trade, qty }) => s + ((exitPrice as number) - trade.entry_price) * qty, 0)
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (exitPrice === '' || exitQty === '' || distribution.length === 0) return;
    setSaving(true);
    try {
      await onSave(distribution.map(({ trade, qty }) => ({
        tradeId: trade.id!,
        exit: { date: exitDate, quantity: qty, price: exitPrice as number, reason, emotions },
      })));
    } finally {
      setSaving(false);
    }
  };

  const isPartial = exitQty !== '' && (exitQty as number) < totalRemaining;

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Close Position — {stock}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-section">
              <div className="form-section-title">Open Entries — FIFO order</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f1f5f9' }}>
                    <th style={th}>Entry Date</th>
                    <th style={{ ...th, textAlign: 'right' }}>Remaining</th>
                    <th style={{ ...th, textAlign: 'right' }}>Entry Price</th>
                    <th style={{ ...th, textAlign: 'right' }}>Will Exit</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(t => {
                    const dist = distribution.find(d => d.trade.id === t.id);
                    return (
                      <tr key={t.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '5px 8px' }}>{fmtDate(t.entry_date)}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right' }}>{remainingQty(t)}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right' }}>{sym}{t.entry_price.toLocaleString(locale, { maximumFractionDigits: 2 })}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: dist ? 600 : 400, color: dist ? '#1e40af' : '#c1c8d0' }}>
                          {dist ? dist.qty : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ marginTop: 6, fontSize: 11, color: '#6c757d' }}>
                Total remaining: <strong>{totalRemaining}</strong> shares
              </div>
            </div>

            <div className="form-section">
              <div className="form-section-title">Exit Details</div>
              <div className="form-grid">
                <div className="form-group">
                  <label>Exit Date</label>
                  <input type="date" value={exitDate} onChange={e => setExitDate(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Quantity (max {totalRemaining})</label>
                  <input
                    type="number"
                    min={currency === 'USD' ? '0.0000000001' : '1'}
                    step={currency === 'USD' ? 'any' : '1'}
                    value={exitQty}
                    onChange={e => {
                      const v = e.target.value;
                      if (v === '') { setExitQty(''); return; }
                      const n = parseFloat(v);
                      if (!isNaN(n)) setExitQty(Math.min(n, totalRemaining));
                    }}
                  />
                  {isPartial && (
                    <span style={{ fontSize: 11, color: '#f59e0b', marginTop: 3 }}>
                      {Math.round((totalRemaining - (exitQty as number)) * 1e10) / 1e10} shares remain after this exit (Partial)
                    </span>
                  )}
                </div>
                <div className="form-group">
                  <label>Exit Price ({sym}) *</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={exitPrice}
                    onChange={e => setExitPrice(parseFloat(e.target.value) || '')}
                    placeholder="Price per share"
                    autoFocus
                  />
                </div>
              </div>
            </div>

            <div className="form-section">
              <div className="form-section-title">Notes</div>
              <div className="form-group">
                <label>Reason for Exit</label>
                <input
                  list="grp-exit-reason-opts"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Target hit, Stop loss, Trailing SL, etc."
                  style={{ width: '100%', padding: '8px', borderRadius: 4, border: '1px solid #cbd5e1' }}
                />
                <datalist id="grp-exit-reason-opts">
                  {exitReasonSuggestions.map(o => <option key={o} value={o} />)}
                </datalist>
              </div>
              <div className="form-group" style={{ marginTop: 10 }}>
                <label>Emotions / Psychology</label>
                <input
                  list="grp-emotion-opts"
                  value={emotions}
                  onChange={e => setEmotions(e.target.value)}
                  placeholder="Disciplined, FOMO, Fearful, etc."
                  style={{ width: '100%', padding: '8px', borderRadius: 4, border: '1px solid #cbd5e1' }}
                />
                <datalist id="grp-emotion-opts">
                  {emotionSuggestions.map(o => <option key={o} value={o} />)}
                </datalist>
              </div>
            </div>

            {thisPL != null && (
              <div className="calc-preview">
                <div className="item">Estimated P/L: <span style={{ color: thisPL >= 0 ? '#16a34a' : '#dc2626' }}>
                  {thisPL >= 0 ? '+' : ''}{sym}{Math.abs(thisPL).toLocaleString(locale, { maximumFractionDigits: 0 })}
                </span></div>
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || exitPrice === '' || exitQty === '' || totalRemaining <= 0}>
              {saving ? 'Saving…' : isPartial ? 'Save Partial Exit' : 'Close Position'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '5px 6px', textAlign: 'left', fontWeight: 600, color: '#475569' };
