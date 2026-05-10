import { useState } from 'react';
import { Trade } from '../types';

interface Props {
  trades: Trade[];
}

const SL_KEYWORDS = ['sl', 'stop loss', 'stoploss', 'stop-loss', 'sl hit', 'stopped out', 'sl triggered'];

function isSlExit(reason: string): boolean {
  const r = reason.toLowerCase().trim();
  return SL_KEYWORDS.some(kw => r.includes(kw));
}

function getConsecutiveSlCount(trades: Trade[]): number {
  const closed = [...trades]
    .filter(t => t.status === 'Closed' && t.reason_for_exit)
    .sort((a, b) => {
      const da = (t: Trade) => t.exit_date ?? t.entry_date;
      return da(b).localeCompare(da(a)); // newest first
    });

  let count = 0;
  for (const t of closed) {
    const exits = t.exits ?? [];
    const slInExits = exits.length > 0
      ? exits.some(e => isSlExit(e.reason ?? ''))
      : isSlExit(t.reason_for_exit ?? '');
    if (slInExits) count++;
    else break;
  }
  return count;
}

function getRecentWinRate(trades: Trade[], n = 8): { winRate: number; count: number } | null {
  const recent = [...trades]
    .filter(t => t.status === 'Closed' && t.pl != null)
    .sort((a, b) => (b.exit_date ?? b.entry_date).localeCompare(a.exit_date ?? a.entry_date))
    .slice(0, n);

  if (recent.length < 4) return null;
  const wins = recent.filter(t => (t.pl ?? 0) > 0).length;
  return { winRate: (wins / recent.length) * 100, count: recent.length };
}

export default function SmartAlerts({ trades }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const dismiss = (id: string) => setDismissed(prev => new Set([...prev, id]));

  const alerts: { id: string; level: 'warning' | 'danger'; title: string; body: string }[] = [];

  const slCount = getConsecutiveSlCount(trades);
  if (slCount >= 2) {
    alerts.push({
      id: `sl-${slCount}`,
      level: slCount >= 4 ? 'danger' : 'warning',
      title: `${slCount} consecutive stop losses`,
      body: slCount >= 4
        ? 'Consider sitting out — your strategy may not suit current conditions.'
        : 'Review your setups before the next entry. Market may not be aligned.',
    });
  }

  const recent = getRecentWinRate(trades);
  if (recent && recent.winRate < 35) {
    alerts.push({
      id: `choppy-${Math.round(recent.winRate)}`,
      level: recent.winRate < 20 ? 'danger' : 'warning',
      title: `Win rate ${recent.winRate.toFixed(0)}% in last ${recent.count} trades`,
      body: 'Market may be choppy. Reduce position sizes or wait for clearer setups.',
    });
  }

  const visible = alerts.filter(a => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
      {visible.map(alert => (
        <div key={alert.id} style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
          padding: '10px 14px', borderRadius: 8,
          background: alert.level === 'danger' ? '#fff1f2' : '#fffbeb',
          border: `1px solid ${alert.level === 'danger' ? '#fecdd3' : '#fde68a'}`,
        }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 16, lineHeight: 1.4 }}>{alert.level === 'danger' ? '🚨' : '⚠️'}</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: alert.level === 'danger' ? '#9f1239' : '#92400e' }}>
                {alert.title}
              </div>
              <div style={{ fontSize: 12, color: alert.level === 'danger' ? '#be123c' : '#b45309', marginTop: 2 }}>
                {alert.body}
              </div>
            </div>
          </div>
          <button
            onClick={() => dismiss(alert.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 16, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
            title="Dismiss"
          >×</button>
        </div>
      ))}
    </div>
  );
}
