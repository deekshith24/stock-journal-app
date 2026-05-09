import { useState } from 'react';
import { Trade, ExitRecord } from '../types';

interface Props {
  trade: Trade;
  currency: 'INR' | 'USD';
  exitReasonSuggestions: string[];
  emotionSuggestions: string[];
  onSave: (exit: ExitRecord) => Promise<void>;
  onClose: () => void;
}

function fmtDate(d: string): string {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y.slice(2)}`;
}

export default function ClosePositionModal({ trade, currency, exitReasonSuggestions, emotionSuggestions, onSave, onClose }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const sym = currency === 'INR' ? '₹' : '$';
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';

  const exits = trade.exits ?? [];
  const alreadyExited = exits.length > 0
    ? exits.reduce((s, e) => s + e.quantity, 0)
    : (trade.exit_quantity ?? 0);
  const remaining = trade.entry_quantity - alreadyExited;

  const [exitDate, setExitDate] = useState(today);
  const [exitQty, setExitQty] = useState<number | ''>(remaining);
  const [exitPrice, setExitPrice] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const [emotions, setEmotions] = useState('');
  const [saving, setSaving] = useState(false);

  const thisPL = exitPrice !== '' && exitQty !== '' ? (exitPrice - trade.entry_price) * exitQty : null;
  const prevPL = exits.length > 0
    ? exits.reduce((s, e) => s + (e.price - trade.entry_price) * e.quantity, 0)
    : (trade.exit_price != null ? (trade.exit_price - trade.entry_price) * alreadyExited : 0);
  const totalPL = thisPL != null ? prevPL + thisPL : null;
  const invested = trade.entry_price * trade.entry_quantity;
  const totalPLPct = totalPL != null && invested > 0 ? (totalPL / invested) * 100 : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (exitPrice === '') return;
    setSaving(true);
    try {
      await onSave({ date: exitDate, quantity: exitQty as number, price: exitPrice, reason, emotions });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Close Position — {trade.stock}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">

            {/* Exits history */}
            {alreadyExited > 0 && (
              <div className="form-section">
                <div className="form-section-title">Previous Exits</div>
                {exits.length > 0 ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: '#f1f5f9' }}>
                        <th style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>#</th>
                        <th style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>Date</th>
                        <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: '#475569' }}>Qty</th>
                        <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: '#475569' }}>Price</th>
                        <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: '#475569' }}>P/L</th>
                        <th style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {exits.map((ex, i) => {
                        const pl = (ex.price - trade.entry_price) * ex.quantity;
                        return (
                          <tr key={i} style={{ borderTop: '1px solid #e2e8f0' }}>
                            <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{i + 1}</td>
                            <td style={{ padding: '5px 8px' }}>{fmtDate(ex.date)}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right' }}>{ex.quantity}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right' }}>{sym}{ex.price.toLocaleString(locale, { maximumFractionDigits: 2 })}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', color: pl >= 0 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                              {pl >= 0 ? '+' : ''}{sym}{Math.abs(pl).toLocaleString(locale, { maximumFractionDigits: 0 })}
                            </td>
                            <td style={{ padding: '5px 8px', color: '#64748b', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ex.reason}>{ex.reason || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ fontSize: 12, color: '#64748b', padding: '6px 0' }}>
                    {alreadyExited} shares already exited at {sym}{trade.exit_price?.toLocaleString(locale, { maximumFractionDigits: 2 })}
                  </div>
                )}
                <div style={{ marginTop: 6, fontSize: 11, color: '#6c757d' }}>
                  {alreadyExited} of {trade.entry_quantity} shares exited · <strong>{remaining}</strong> remaining
                </div>
              </div>
            )}

            {/* New exit */}
            <div className="form-section">
              <div className="form-section-title">
                {alreadyExited > 0 ? 'New Exit' : 'Exit Details'}
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label>Exit Date</label>
                  <input type="date" value={exitDate} onChange={e => setExitDate(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Quantity (max {remaining})</label>
                  <input
                    type="number"
                    min={currency === 'USD' ? '0.0000000001' : '1'}
                    step={currency === 'USD' ? 'any' : '1'}
                    max={remaining}
                    value={exitQty}
                    onChange={e => {
                      const v = e.target.value;
                      if (v === '') { setExitQty(''); return; }
                      const n = parseFloat(v);
                      if (!isNaN(n)) setExitQty(Math.min(n, remaining));
                    }}
                  />
                  {exitQty !== '' && exitQty < remaining && (
                    <span style={{ fontSize: 11, color: '#f59e0b', marginTop: 3 }}>
                      {remaining - (exitQty as number)} shares remain after this exit (Partial)
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
                <div className="form-group">
                  <label>Entry Price ({sym})</label>
                  <input
                    readOnly
                    value={trade.entry_price.toLocaleString(locale, { maximumFractionDigits: 2 })}
                    style={{ background: '#f8f9fa', color: '#6c757d' }}
                  />
                </div>
              </div>
            </div>

            <div className="form-section">
              <div className="form-section-title">Notes</div>
              <div className="form-group">
                <label>Reason for Exit</label>
                <input
                  list="exit-reason-options"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Target hit, Stop loss, Trailing SL, etc."
                  style={{ width: '100%', padding: '8px', borderRadius: 4, border: '1px solid #cbd5e1' }}
                />
                <datalist id="exit-reason-options">
                  {exitReasonSuggestions.map(option => <option key={option} value={option} />)}
                </datalist>
              </div>
              <div className="form-group" style={{ marginTop: 10 }}>
                <label>Emotions / Psychology</label>
                <input
                  list="exit-emotion-options"
                  value={emotions}
                  onChange={e => setEmotions(e.target.value)}
                  placeholder="Disciplined, FOMO, Fearful, etc."
                  style={{ width: '100%', padding: '8px', borderRadius: 4, border: '1px solid #cbd5e1' }}
                />
                <datalist id="exit-emotion-options">
                  {emotionSuggestions.map(option => <option key={option} value={option} />)}
                </datalist>
              </div>
            </div>

            {thisPL != null && (
              <div className="calc-preview">
                <div className="item">This exit P/L: <span style={{ color: thisPL >= 0 ? '#16a34a' : '#dc2626' }}>
                  {thisPL >= 0 ? '+' : ''}{sym}{Math.abs(thisPL).toLocaleString(locale, { maximumFractionDigits: 0 })}
                </span></div>
                {alreadyExited > 0 && totalPL != null && (
                  <div className="item">Cumulative P/L: <span style={{ color: totalPL >= 0 ? '#16a34a' : '#dc2626' }}>
                    {totalPL >= 0 ? '+' : ''}{sym}{Math.abs(totalPL).toLocaleString(locale, { maximumFractionDigits: 0 })}
                    {totalPLPct != null && ` (${totalPLPct >= 0 ? '+' : ''}${totalPLPct.toFixed(2)}%)`}
                  </span></div>
                )}
                {alreadyExited === 0 && totalPLPct != null && (
                  <div className="item">P/L %: <span style={{ color: totalPLPct >= 0 ? '#16a34a' : '#dc2626' }}>
                    {totalPLPct >= 0 ? '+' : ''}{totalPLPct.toFixed(2)}%
                  </span></div>
                )}
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || exitPrice === '' || exitQty === '' || remaining <= 0}>
              {saving ? 'Saving…' : exitQty !== '' && exitQty < remaining ? 'Save Partial Exit' : 'Close Position'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
