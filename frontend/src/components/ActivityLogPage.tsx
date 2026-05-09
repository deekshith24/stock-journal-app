import { useState } from 'react';
import { ActivityEntry } from '../types';

interface Props {
  entries: ActivityEntry[];
}

const ACTION_LABELS: Record<string, string> = {
  TRADE_CREATED: 'Trade Added',
  TRADE_UPDATED: 'Trade Edited',
  TRADE_DELETED: 'Trade Deleted',
  EXIT_ADDED:    'Position Closed',
  EXIT_UPDATED:  'Exits Edited',
};

const ACTION_COLORS: Record<string, string> = {
  TRADE_CREATED: '#16a34a',
  TRADE_UPDATED: '#2563eb',
  TRADE_DELETED: '#dc2626',
  EXIT_ADDED:    '#d97706',
  EXIT_UPDATED:  '#7c3aed',
};

function fmtTimestamp(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
  };
}

type MarketFilter = 'all' | 'India' | 'US';
type ActionFilter = 'all' | 'TRADE_CREATED' | 'EXIT_ADDED' | 'TRADE_UPDATED' | 'EXIT_UPDATED' | 'TRADE_DELETED';

export default function ActivityLogPage({ entries }: Props) {
  const [search, setSearch]             = useState('');
  const [marketFilter, setMarketFilter] = useState<MarketFilter>('all');
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all');

  const filtered = entries.filter(e => {
    if (marketFilter !== 'all' && e.market !== marketFilter) return false;
    if (actionFilter !== 'all' && e.action !== actionFilter) return false;
    if (search && !e.stock.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <div className="filter-tabs">
          {(['all', 'India', 'US'] as MarketFilter[]).map(m => (
            <button key={m} className={`tab-btn ${marketFilter === m ? 'active' : ''}`} onClick={() => setMarketFilter(m)}>
              {m === 'all' ? 'All' : m === 'India' ? 'India' : 'US'}
            </button>
          ))}
        </div>
        <div className="filter-tabs">
          {(['all', 'TRADE_CREATED', 'EXIT_ADDED', 'TRADE_UPDATED', 'EXIT_UPDATED', 'TRADE_DELETED'] as ActionFilter[]).map(a => (
            <button key={a} className={`tab-btn ${actionFilter === a ? 'active' : ''}`} onClick={() => setActionFilter(a)}>
              {a === 'all' ? 'All actions' : ACTION_LABELS[a]}
            </button>
          ))}
        </div>
        <input
          className="search-box"
          placeholder="Search stock…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span style={{ fontSize: 12, color: '#6c757d', marginLeft: 'auto' }}>
          {filtered.length} event{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="table-wrapper">
          <div className="empty-state">
            <div className="icon">📋</div>
            <p>{entries.length === 0
              ? 'No activity yet. Your trade actions will appear here.'
              : 'No activity matches the current filters.'}</p>
          </div>
        </div>
      ) : (
        <div className="table-wrapper">
          <div className="table-scroll">
            <table style={{ minWidth: 700 }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Date & Time</th>
                  <th>Action</th>
                  <th>Market</th>
                  <th>Stock</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, i) => {
                  const { date, time } = fmtTimestamp(e.timestamp);
                  const color = ACTION_COLORS[e.action] ?? '#6c757d';
                  return (
                    <tr key={e.id}>
                      <td style={{ color: '#9aa3af', fontSize: 11 }}>{filtered.length - i}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 500, fontSize: 12 }}>{date}</div>
                        <div style={{ fontSize: 11, color: '#6c757d' }}>{time}</div>
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          background: color + '20',
                          color,
                          whiteSpace: 'nowrap',
                        }}>
                          {ACTION_LABELS[e.action] ?? e.action}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        {e.market === 'India' ? '🇮🇳' : '🇺🇸'} {e.market}
                      </td>
                      <td><span className="stock-name">{e.stock}</span></td>
                      <td style={{ fontSize: 12, color: '#374151' }}>{e.details}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
