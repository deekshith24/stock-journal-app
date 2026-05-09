import { useState } from 'react';
import { Trade, ExitRecord } from '../types';
import { exitReasonOptions, emotionOptions } from '../constants';

interface Props {
  trade: Trade;
  currency: 'INR' | 'USD';
  onSave: (exits: ExitRecord[]) => Promise<void>;
  onClose: () => void;
}

export default function EditExitsModal({ trade, currency, onSave, onClose }: Props) {
  const sym    = currency === 'INR' ? '₹' : '$';
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  const isUS   = currency === 'USD';

  const [exits, setExits] = useState<ExitRecord[]>(
    trade.exits && trade.exits.length > 0
      ? trade.exits.map(e => ({ ...e }))
      : trade.exit_quantity && trade.exit_price
        ? [{ date: trade.exit_date ?? '', quantity: trade.exit_quantity, price: trade.exit_price, reason: trade.reason_for_exit ?? '', emotions: trade.emotions ?? '' }]
        : []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const totalExited = exits.reduce((s, e) => s + (Number(e.quantity) || 0), 0);
  const remaining   = Math.round((trade.entry_quantity - totalExited) * 1e8) / 1e8;

  const update = (i: number, field: keyof ExitRecord, value: string | number) => {
    setExits(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: value } : e));
    setError(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totalExited > trade.entry_quantity + 1e-8) {
      setError(`Total exit qty (${totalExited}) exceeds entry qty (${trade.entry_quantity})`);
      return;
    }
    setSaving(true);
    try {
      await onSave(exits);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 720 }} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit Exits — {trade.stock}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSave}>
          <div className="modal-body">
            <div style={{ fontSize: 12, color: '#6c757d', marginBottom: 12 }}>
              Entry: {fmtQty(trade.entry_quantity, isUS)} shares @ {sym}{trade.entry_price.toLocaleString(locale, { maximumFractionDigits: 4 })}
              {remaining > 0 && <span style={{ marginLeft: 12, color: '#f59e0b', fontWeight: 600 }}>{fmtQty(remaining, isUS)} shares still open after these exits</span>}
              {remaining < 0 && <span style={{ marginLeft: 12, color: '#dc2626', fontWeight: 600 }}>Over-exit by {fmtQty(Math.abs(remaining), isUS)} shares!</span>}
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f1f5f9' }}>
                  <th style={th}>#</th>
                  <th style={th}>Date</th>
                  <th style={{ ...th, textAlign: 'right' }}>Qty</th>
                  <th style={{ ...th, textAlign: 'right' }}>Price ({sym})</th>
                  <th style={{ ...th, textAlign: 'right' }}>P/L</th>
                  <th style={th}>Reason</th>
                  <th style={th}>Emotions</th>
                </tr>
              </thead>
              <tbody>
                {exits.map((ex, i) => {
                  const pl = (Number(ex.price) - trade.entry_price) * Number(ex.quantity);
                  return (
                    <tr key={i} style={{ borderTop: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '6px 8px', color: '#94a3b8' }}>{i + 1}</td>
                      <td style={{ padding: '4px 6px' }}>
                        <input type="date" value={ex.date} onChange={e => update(i, 'date', e.target.value)}
                          style={inp} required />
                      </td>
                      <td style={{ padding: '4px 6px' }}>
                        <input type="number" value={ex.quantity} min={isUS ? '0.0000000001' : '1'} step={isUS ? 'any' : '1'}
                          onChange={e => update(i, 'quantity', parseFloat(e.target.value) || 0)}
                          style={{ ...inp, textAlign: 'right', width: 90 }} required />
                      </td>
                      <td style={{ padding: '4px 6px' }}>
                        <input type="number" value={ex.price} min="0" step="0.0001"
                          onChange={e => update(i, 'price', parseFloat(e.target.value) || 0)}
                          style={{ ...inp, textAlign: 'right', width: 100 }} required />
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: pl >= 0 ? '#16a34a' : '#dc2626' }}>
                        {pl >= 0 ? '+' : ''}{sym}{Math.abs(pl).toLocaleString(locale, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '4px 6px' }}>
                        <input list="exit-reason-options" value={ex.reason ?? ''} onChange={e => update(i, 'reason', e.target.value)}
                          placeholder="Reason" style={{ ...inp, width: 140 }} />
                      </td>
                      <td style={{ padding: '4px 6px' }}>
                        <input list="exit-emotion-options" value={ex.emotions ?? ''} onChange={e => update(i, 'emotions', e.target.value)}
                          placeholder="Emotions" style={{ ...inp, width: 120 }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid #e2e8f0', background: '#f8fafc' }}>
                  <td colSpan={2} style={{ padding: '6px 8px', fontWeight: 700, fontSize: 11, color: '#475569' }}>TOTAL</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>{fmtQty(totalExited, isUS)}</td>
                  <td />
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>
                    {(() => {
                      const totalPL = exits.reduce((s, e) => s + (Number(e.price) - trade.entry_price) * Number(e.quantity), 0);
                      return <span style={{ color: totalPL >= 0 ? '#16a34a' : '#dc2626' }}>
                        {totalPL >= 0 ? '+' : ''}{sym}{Math.abs(totalPL).toLocaleString(locale, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
                      </span>;
                    })()}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>

            {error && <div style={{ marginTop: 10, color: '#dc2626', fontSize: 12 }}>{error}</div>}
            <datalist id="exit-reason-options">
              {exitReasonOptions.map(option => <option key={option} value={option} />)}
            </datalist>
            <datalist id="exit-emotion-options">
              {emotionOptions.map(option => <option key={option} value={option} />)}
            </datalist>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || remaining < -1e-8}>
              {saving ? 'Saving…' : 'Save Exits'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function fmtQty(n: number, isUS: boolean): string {
  if (!isUS || Number.isInteger(n)) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

const th: React.CSSProperties = { padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#475569' };
const inp: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 4, padding: '4px 6px', fontSize: 12, outline: 'none', width: '100%' };
