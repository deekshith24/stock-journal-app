import { useState, useEffect } from 'react';
import { Trade, ExitRecord } from '../types';
import { entryReasonOptions, exitReasonOptions, emotionOptions } from '../constants';

interface TradeEntryData {
  stock: string;
  trade_type: 'swing' | 'positional';
  entry_date: string;
  entry_quantity: number;
  entry_price: number;
  reason_for_entry: string;
}

interface Props {
  trade: Trade | null;
  defaultTradeType: 'swing' | 'positional';
  currency: 'INR' | 'USD';
  initialStock?: string;
  entryReasonSuggestions: string[];
  exitReasonSuggestions: string[];
  emotionSuggestions: string[];
  onSave: (data: TradeEntryData, exits?: ExitRecord[]) => Promise<void>;
  onClose: () => void;
}

const EMPTY: Omit<TradeEntryData, 'entry_date'> = {
  stock: '',
  trade_type: 'swing',
  entry_quantity: 0,
  entry_price: 0,
  reason_for_entry: '',
};

const getTodayDate = () => new Date().toISOString().slice(0, 10);

function initialExits(trade: Trade | null): ExitRecord[] | null {
  if (!trade) return null;
  if (trade.exits && trade.exits.length > 0) return trade.exits.map(e => ({ ...e }));
  if (trade.exit_quantity && trade.exit_price) {
    return [{ date: trade.exit_date ?? getTodayDate(), quantity: trade.exit_quantity, price: trade.exit_price, reason: trade.reason_for_exit ?? '', emotions: trade.emotions ?? '' }];
  }
  return null;
}

export default function TradeForm({ trade, defaultTradeType, currency, initialStock, entryReasonSuggestions, exitReasonSuggestions, emotionSuggestions, onSave, onClose }: Props) {
  const [form, setForm] = useState<TradeEntryData>({ ...EMPTY, stock: initialStock ?? '', trade_type: defaultTradeType, entry_date: getTodayDate() });
  const [exits, setExits] = useState<ExitRecord[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [entryReasonPreset, setEntryReasonPreset] = useState('');

  const sym    = currency === 'INR' ? '₹' : '$';
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  const isUS   = currency === 'USD';

  useEffect(() => {
    if (trade) {
      setForm({
        stock: trade.stock,
        trade_type: trade.trade_type ?? defaultTradeType,
        entry_date: trade.entry_date,
        entry_quantity: trade.entry_quantity,
        entry_price: trade.entry_price,
        reason_for_entry: trade.reason_for_entry,
      });
      const presetValue = entryReasonOptions.includes(trade.reason_for_entry)
        ? trade.reason_for_entry
        : entryReasonSuggestions.includes(trade.reason_for_entry)
          ? trade.reason_for_entry
          : '';
      setEntryReasonPreset(presetValue);
      setExits(initialExits(trade));
    } else {
      setForm({ ...EMPTY, trade_type: defaultTradeType, entry_date: getTodayDate() });
      setEntryReasonPreset('');
      setExits(null);
    }
  }, [trade, defaultTradeType]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (field: keyof TradeEntryData, value: unknown) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const updateExit = (i: number, field: keyof ExitRecord, value: string | number) =>
    setExits(prev => prev ? prev.map((e, idx) => idx === i ? { ...e, [field]: value } : e) : prev);

  const totalExited = exits ? exits.reduce((s, e) => s + (Number(e.quantity) || 0), 0) : 0;
  const remaining   = Math.round((form.entry_quantity - totalExited) * 1e8) / 1e8;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ ...form, stock: form.stock.toUpperCase().trim() }, exits ?? undefined);
    } finally {
      setSaving(false);
    }
  };

  const invested = (form.entry_price || 0) * (form.entry_quantity || 0);

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: exits ? 760 : 700 }} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{trade ? `Edit — ${trade.stock}` : `Add ${form.trade_type === 'positional' ? 'Positional' : 'Swing'} Trade`}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {/* Entry details */}
            <div className="form-section">
              <div className="form-section-title">Entry Details</div>
              <div className="form-grid">
                <div className="form-group">
                  <label>Stock *</label>
                  <input required value={form.stock} onChange={e => set('stock', e.target.value.toUpperCase())}
                    placeholder={isUS ? 'e.g. AAPL' : 'e.g. RELIANCE'} style={{ textTransform: 'uppercase' }} />
                </div>
                <div className="form-group">
                  <label>Entry Date *</label>
                  <input type="date" required value={form.entry_date} onChange={e => set('entry_date', e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Entry Quantity *</label>
                  <input type="number" required min={isUS ? '0.000001' : '1'} step={isUS ? '0.000001' : '1'}
                    value={form.entry_quantity || ''}
                    onChange={e => set('entry_quantity', parseFloat(e.target.value) || 0)}
                    placeholder="No. of shares" />
                </div>
                <div className="form-group">
                  <label>Entry Price ({sym}) *</label>
                  <input type="number" required min="0" step="0.0001" value={form.entry_price || ''}
                    onChange={e => set('entry_price', parseFloat(e.target.value) || 0)}
                    placeholder="Price per share" />
                </div>
                <div className="form-group">
                  <label>Invested ({sym})</label>
                  <input readOnly value={invested > 0 ? invested.toLocaleString(locale, { maximumFractionDigits: 2 }) : ''}
                    style={{ background: '#f8f9fa', color: '#6c757d' }} />
                </div>
              </div>
            </div>

          {/* Exits section — shown right after entry details when trade has exits */}
            {exits && exits.length > 0 && (
              <div className="form-section">
                <div className="form-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Exit Records</span>
                  <span style={{ fontSize: 11, fontWeight: 400, color: remaining < 0 ? '#dc2626' : remaining > 0 ? '#f59e0b' : '#16a34a' }}>
                    {remaining > 0 ? `${remaining} shares still open` : remaining < 0 ? `Over-exit by ${Math.abs(remaining)}!` : 'Fully closed'}
                  </span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9' }}>
                      <th style={th}>#</th>
                      <th style={th}>Date</th>
                      <th style={{ ...th, textAlign: 'right' }}>Qty</th>
                      <th style={{ ...th, textAlign: 'right' }}>Price ({sym})</th>
                      <th style={{ ...th, textAlign: 'right' }}>P/L</th>
                      <th style={th}>Reason for Exit</th>
                      <th style={th}>Emotions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exits.map((ex, i) => {
                      const pl = (Number(ex.price) - form.entry_price) * Number(ex.quantity);
                      return (
                        <tr key={i} style={{ borderTop: '1px solid #e2e8f0' }}>
                          <td style={{ padding: '5px 6px', color: '#94a3b8' }}>{i + 1}</td>
                          <td style={{ padding: '3px 4px' }}>
                            <input type="date" value={ex.date} onChange={e => updateExit(i, 'date', e.target.value)}
                              style={inp} required />
                          </td>
                          <td style={{ padding: '3px 4px' }}>
                            <input type="number" value={ex.quantity} min={isUS ? '0.0000000001' : '1'} step={isUS ? 'any' : '1'}
                              onChange={e => updateExit(i, 'quantity', parseFloat(e.target.value) || 0)}
                              style={{ ...inp, textAlign: 'right', width: 80 }} required />
                          </td>
                          <td style={{ padding: '3px 4px' }}>
                            <input type="number" value={ex.price} min="0" step="0.0001"
                              onChange={e => updateExit(i, 'price', parseFloat(e.target.value) || 0)}
                              style={{ ...inp, textAlign: 'right', width: 90 }} required />
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: pl >= 0 ? '#16a34a' : '#dc2626', whiteSpace: 'nowrap' }}>
                            {pl >= 0 ? '+' : ''}{sym}{Math.abs(pl).toLocaleString(locale, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
                          </td>
                          <td style={{ padding: '3px 4px' }}>
                            <input list="exit-reason-options" value={ex.reason ?? ''} onChange={e => updateExit(i, 'reason', e.target.value)}
                              placeholder="Reason" style={{ ...inp, width: 140 }} />
                          </td>
                          <td style={{ padding: '3px 4px' }}>
                            <input list="exit-emotion-options" value={ex.emotions ?? ''} onChange={e => updateExit(i, 'emotions', e.target.value)}
                              placeholder="Emotions" style={{ ...inp, width: 120 }} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <datalist id="exit-reason-options">
                  {exitReasonSuggestions.concat(exitReasonOptions)
                    .filter((value, index, array) => value && array.indexOf(value) === index)
                    .map(value => <option key={value} value={value} />)}
                </datalist>
                <datalist id="exit-emotion-options">
                  {emotionSuggestions.concat(emotionOptions)
                    .filter((value, index, array) => value && array.indexOf(value) === index)
                    .map(value => <option key={value} value={value} />)}
                </datalist>
              </div>
            )}

            <div className="form-section">
              <div className="form-section-title">Notes</div>
              <div className="form-group">
                <label>Reason for Entry</label>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                  <select value={entryReasonPreset} onChange={e => {
                    const value = e.target.value;
                    setEntryReasonPreset(value);
                    set('reason_for_entry', value);
                  }} style={{ minWidth: 220, padding: '6px 8px', borderRadius: 4, border: '1px solid #cbd5e1' }}>
                    <option value="">Choose preset reason</option>
                    <optgroup label="Common reasons">
                      {entryReasonOptions.map(reason => (
                        <option key={reason} value={reason}>{reason}</option>
                      ))}
                    </optgroup>
                    {entryReasonSuggestions.filter(reason => !entryReasonOptions.includes(reason)).length > 0 && (
                      <optgroup label="From existing trades">
                        {entryReasonSuggestions
                          .filter(reason => !entryReasonOptions.includes(reason))
                          .map(reason => (
                            <option key={reason} value={reason}>{reason}</option>
                          ))}
                      </optgroup>
                    )}
                  </select>
                  <span style={{ fontSize: 12, color: '#64748b' }}>or type a custom reason below</span>
                </div>
                <textarea rows={2} value={form.reason_for_entry} onChange={e => {
                  const value = e.target.value;
                  set('reason_for_entry', value);
                  setEntryReasonPreset(entryReasonOptions.includes(value) ? value : '');
                }}
                  placeholder="Why did you enter this trade? (setup, sector, indicator…)" />
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || (exits != null && remaining < -1e-8)}>
              {saving ? 'Saving…' : trade ? 'Save Changes' : 'Add Trade'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '5px 6px', textAlign: 'left', fontWeight: 600, color: '#475569' };
const inp: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 4, padding: '3px 6px', fontSize: 12, outline: 'none', width: '100%' };
