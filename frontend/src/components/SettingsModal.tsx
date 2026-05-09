import { useState } from 'react';
import { Settings } from '../types';

interface Props {
  settings: Settings;
  currentUsdToInr?: number;
  currentUsdToInrDate?: string;
  onSave: (s: Settings) => Promise<void>;
  onClose: () => void;
}

export default function SettingsModal({ settings, currentUsdToInr, currentUsdToInrDate, onSave, onClose }: Props) {
  const [portfolioSize, setPortfolioSize] = useState(String(settings.portfolio_size));
  const [usPortfolioSize, setUsPortfolioSize] = useState(String(settings.us_portfolio_size));
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        portfolio_size: parseFloat(portfolioSize) || 300000,
        us_portfolio_size: parseFloat(usPortfolioSize) || 50000,
        usd_to_inr: settings.usd_to_inr,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>⚙ Settings</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-section">
              <div className="form-section-title">India Portfolio</div>
              <div className="form-group">
                <label>Total Portfolio Size (₹)</label>
                <input
                  type="number"
                  min="1"
                  value={portfolioSize}
                  onChange={e => setPortfolioSize(e.target.value)}
                  placeholder="300000"
                />
                <span style={{ fontSize: 11, color: '#6c757d', marginTop: 4 }}>
                  Used to calculate PF% for India trades.
                  Currently: ₹{(parseFloat(portfolioSize) || 0).toLocaleString('en-IN')}
                </span>
              </div>
            </div>
            <div className="form-section">
              <div className="form-section-title">US Portfolio</div>
              <div className="form-group">
                <label>Total Portfolio Size ($)</label>
                <input
                  type="number"
                  min="1"
                  value={usPortfolioSize}
                  onChange={e => setUsPortfolioSize(e.target.value)}
                  placeholder="50000"
                />
                <span style={{ fontSize: 11, color: '#6c757d', marginTop: 4 }}>
                  Used to calculate PF% for US trades.
                  Currently: ${(parseFloat(usPortfolioSize) || 0).toLocaleString('en-US')}
                </span>
              </div>
              <div className="form-group" style={{ marginTop: 12 }}>
                <label>USD → INR Exchange Rate</label>
                <div style={{ padding: '10px 12px', background: '#f8f9fa', borderRadius: 6, color: '#111' }}>
                  {currentUsdToInr
                    ? `₹${currentUsdToInr.toFixed(2)}${currentUsdToInrDate ? ` (as of ${currentUsdToInrDate})` : ''}`
                    : 'Not available yet'}
                </div>
                <span style={{ fontSize: 11, color: '#6c757d', marginTop: 4 }}>
                  This value is read-only and reflects the latest known historical USD→INR rate.
                </span>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
