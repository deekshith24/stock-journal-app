import { useState, useMemo } from 'react';
import {
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Trade, Settings } from '../types';

interface Props {
  indiaTrades: Trade[];
  usTrades: Trade[];
  settings: Settings;
}

type TimePeriod = '1M' | '3M' | '6M' | '1Y' | 'ALL' | 'CUSTOM';

const TIME_OPTIONS: { label: string; value: TimePeriod; days: number }[] = [
  { label: '1M',     value: '1M',     days: 30  },
  { label: '3M',     value: '3M',     days: 90  },
  { label: '6M',     value: '6M',     days: 180 },
  { label: '1Y',     value: '1Y',     days: 365 },
  { label: 'All',    value: 'ALL',    days: 0   },
  { label: 'Custom', value: 'CUSTOM', days: 0   },
];

const C = {
  open:    '#f59e0b',
  partial: '#8b5cf6',
  closed:  '#60a5fa',
  profit:  '#10b981',
  loss:    '#f43f5e',
  neutral: '#94a3b8',
  blue:    '#3b82f6',
  cyan:    '#06b6d4',
  purple:  '#8b5cf6',
};

// ── helpers ───────────────────────────────────────────────────────────────────

function filterByTime(trades: Trade[], period: TimePeriod, from: string, to: string): Trade[] {
  if (period === 'ALL') return trades;
  if (period === 'CUSTOM') {
    return trades.filter(t =>
      (!from || t.entry_date >= from) &&
      (!to   || t.entry_date <= to)
    );
  }
  const opt = TIME_OPTIONS.find(o => o.value === period)!;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - opt.days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return trades.filter(t => t.entry_date >= cutoffStr);
}

function getStatusData(trades: Trade[]) {
  return [
    { name: 'Open',    value: trades.filter(t => t.status === 'Open').length,    fill: C.open    },
    { name: 'Partial', value: trades.filter(t => t.status === 'Partial').length, fill: C.partial },
    { name: 'Closed',  value: trades.filter(t => t.status === 'Closed').length,  fill: C.closed  },
  ].filter(d => d.value > 0);
}

function getWinLossData(trades: Trade[]) {
  const closed = trades.filter(t => t.status === 'Closed');
  return [
    { name: 'Profit',    value: closed.filter(t => (t.pl ?? 0) > 0).length,  fill: C.profit  },
    { name: 'Loss',      value: closed.filter(t => (t.pl ?? 0) < 0).length,  fill: C.loss    },
    { name: 'Breakeven', value: closed.filter(t => (t.pl ?? 0) === 0).length, fill: C.neutral },
  ].filter(d => d.value > 0);
}

function getMonthlyPL(trades: Trade[]) {
  const closed = trades.filter(t => t.status === 'Closed' && t.exit_date);
  const map: Record<string, number> = {};
  for (const t of closed) {
    const key = t.exit_date!.slice(0, 7);
    map[key] = (map[key] || 0) + (t.pl ?? 0);
  }
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, pl]) => ({
      month: new Date(key + '-01').toLocaleDateString('en', { month: 'short', year: '2-digit' }),
      pl: Math.round(pl),
    }));
}

function getStockPL(trades: Trade[]) {
  const closed = trades.filter(t => t.status === 'Closed');
  const map: Record<string, number> = {};
  for (const t of closed) map[t.stock] = (map[t.stock] || 0) + (t.pl ?? 0);
  return Object.entries(map)
    .map(([stock, pl]) => ({ stock, pl: Math.round(pl) }))
    .sort((a, b) => Math.abs(b.pl) - Math.abs(a.pl))
    .slice(0, 10);
}

function getOpenAllocation(trades: Trade[]) {
  return trades
    .filter(t => (t.status === 'Open' || t.status === 'Partial') && (t.pf_percentage ?? 0) > 0)
    .sort((a, b) => (b.pf_percentage ?? 0) - (a.pf_percentage ?? 0))
    .slice(0, 10)
    .map(t => ({ stock: t.stock, pf: parseFloat((t.pf_percentage ?? 0).toFixed(1)) }));
}

function getDurationBuckets(trades: Trade[]) {
  const b: Record<string, number> = { '0–5d': 0, '6–15d': 0, '16–30d': 0, '31–60d': 0, '61d+': 0 };
  for (const t of trades) {
    const d = parseInt(t.days_in_trade ?? '0');
    if (d <= 5)       b['0–5d']++;
    else if (d <= 15) b['6–15d']++;
    else if (d <= 30) b['16–30d']++;
    else if (d <= 60) b['31–60d']++;
    else              b['61d+']++;
  }
  return Object.entries(b).map(([bucket, count]) => ({ bucket, count }));
}

// ── sub-components ────────────────────────────────────────────────────────────

function Card({ title, full, children }: { title: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={`a-card${full ? ' a-full' : ''}`}>
      <div className="a-card-title">{title}</div>
      {children}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="a-empty">{msg}</div>;
}

const RADIAN = Math.PI / 180;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PieLabel(props: any) {
  const { cx, cy, midAngle, innerRadius, outerRadius, percent } = props;
  if (percent < 0.06) return null;
  const r = innerRadius + (outerRadius - innerRadius) * 0.55;
  return (
    <text
      x={cx + r * Math.cos(-midAngle * RADIAN)}
      y={cy + r * Math.sin(-midAngle * RADIAN)}
      fill="white" textAnchor="middle" dominantBaseline="central"
      fontSize={11} fontWeight={700}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

// ── main ──────────────────────────────────────────────────────────────────────

export default function AnalyticsPage({ indiaTrades, usTrades, settings: _settings }: Props) {
  const [market, setMarket] = useState<'india' | 'us'>('india');
  const [period, setPeriod] = useState<TimePeriod>('ALL');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const allTrades = market === 'india' ? indiaTrades : usTrades;
  const trades = useMemo(() => filterByTime(allTrades, period, customFrom, customTo), [allTrades, period, customFrom, customTo]);
  const sym = market === 'india' ? '₹' : '$';
  const locale = market === 'india' ? 'en-IN' : 'en-US';

  // Summary stats
  const closed = trades.filter(t => t.status === 'Closed');
  const totalPL = closed.reduce((s, t) => s + (t.pl ?? 0), 0);
  const wins = closed.filter(t => (t.pl ?? 0) > 0).length;
  const losses = closed.filter(t => (t.pl ?? 0) < 0).length;
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : null;
  const avgDays = closed.length > 0
    ? closed.reduce((s, t) => s + parseInt(t.days_in_trade ?? '0'), 0) / closed.length
    : null;
  const openCount    = trades.filter(t => t.status === 'Open').length;
  const partialCount = trades.filter(t => t.status === 'Partial').length;

  // Chart data
  const sd  = useMemo(() => getStatusData(trades),      [trades]);
  const wl  = useMemo(() => getWinLossData(trades),     [trades]);
  const mpl = useMemo(() => getMonthlyPL(trades),       [trades]);
  const spl = useMemo(() => getStockPL(trades),         [trades]);
  const oa  = useMemo(() => getOpenAllocation(trades),  [trades]);
  const dur = useMemo(() => getDurationBuckets(trades), [trades]);

  const fmtMoney = (v: number) => `${sym}${Math.abs(v).toLocaleString(locale, { maximumFractionDigits: 0 })}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const moneyTip = (label: string) => (v: any) => [fmtMoney(Number(v)), label] as [string, string];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const countTip = (label: string) => (v: any) => [`${v} trades`, label] as [string, string];

  return (
    <div className="analytics-page">
      {/* Header */}
      <div className="a-header">
        <span className="a-title">Analytics</span>
        <div className="currency-toggle">
          <button className={`toggle-btn ${market === 'india' ? 'active' : ''}`} onClick={() => setMarket('india')}>India</button>
          <button className={`toggle-btn ${market === 'us' ? 'active' : ''}`} onClick={() => setMarket('us')}>US</button>
        </div>
        <div className="a-time-filter">
          {TIME_OPTIONS.map(o => (
            <button
              key={o.value}
              className={`a-time-btn ${period === o.value ? 'active' : ''}`}
              onClick={() => setPeriod(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
        {period === 'CUSTOM' && (
          <div className="date-range-inputs">
            <input
              type="date"
              className="date-input"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              placeholder="From"
            />
            <span style={{ color: '#9aa3af', fontSize: 12 }}>–</span>
            <input
              type="date"
              className="date-input"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              placeholder="To"
            />
          </div>
        )}
        <span style={{ fontSize: 11, color: '#6c757d' }}>{trades.length} trades</span>
      </div>

      {/* Summary stats */}
      <div className="a-stats-grid">
        <div className="a-stat-card" style={{ '--accent': totalPL >= 0 ? C.profit : C.loss } as React.CSSProperties}>
          <div className="a-stat-label">Total P/L</div>
          <div className="a-stat-value" style={{ color: totalPL >= 0 ? C.profit : C.loss }}>
            {closed.length === 0 ? '—' : `${totalPL >= 0 ? '+' : '−'}${fmtMoney(totalPL)}`}
          </div>
          <div className="a-stat-sub">{closed.length} closed trade{closed.length !== 1 ? 's' : ''}</div>
        </div>

        <div className="a-stat-card" style={{ '--accent': C.blue } as React.CSSProperties}>
          <div className="a-stat-label">Win Rate</div>
          <div className="a-stat-value" style={{ color: C.blue }}>
            {winRate != null ? `${winRate.toFixed(1)}%` : '—'}
          </div>
          <div className="a-stat-sub">{wins}W · {losses}L{closed.length === 0 ? ' (no closed trades)' : ''}</div>
        </div>

        <div className="a-stat-card" style={{ '--accent': C.purple } as React.CSSProperties}>
          <div className="a-stat-label">Total Trades</div>
          <div className="a-stat-value" style={{ color: C.purple }}>{trades.length}</div>
          <div className="a-stat-sub">
            {openCount > 0 ? `${openCount} open` : ''}
            {openCount > 0 && partialCount > 0 ? ' · ' : ''}
            {partialCount > 0 ? `${partialCount} partial` : ''}
            {openCount === 0 && partialCount === 0 ? 'all closed' : ''}
          </div>
        </div>

        <div className="a-stat-card" style={{ '--accent': C.open } as React.CSSProperties}>
          <div className="a-stat-label">Avg Hold</div>
          <div className="a-stat-value" style={{ color: C.open }}>
            {avgDays != null ? `${Math.round(avgDays)}d` : '—'}
          </div>
          <div className="a-stat-sub">average days in closed trades</div>
        </div>
      </div>

      {trades.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#6c757d', fontSize: 14 }}>
          No trades in this period.
        </div>
      ) : (
        <div className="a-grid">

          {/* 1 — Status distribution */}
          <Card title="Trade Status Distribution">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={sd} cx="50%" cy="50%" innerRadius={60} outerRadius={95}
                  dataKey="value" labelLine={false} label={PieLabel}>
                  {sd.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Pie>
                <Tooltip formatter={countTip('Trades')} />
                <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>

          {/* 2 — Win / Loss */}
          <Card title="Win / Loss (Closed Trades)">
            {wl.length === 0
              ? <Empty msg="No closed trades yet" />
              : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={wl} cx="50%" cy="50%" innerRadius={60} outerRadius={95}
                      dataKey="value" labelLine={false} label={PieLabel}>
                      {wl.map((e, i) => <Cell key={i} fill={e.fill} />)}
                    </Pie>
                    <Tooltip formatter={countTip('Trades')} />
                    <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              )
            }
          </Card>

          {/* 3 — Monthly P/L */}
          <Card title="Monthly P/L" full>
            {mpl.length === 0
              ? <Empty msg="No closed trades with exit dates yet" />
              : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={mpl} margin={{ top: 6, right: 24, left: 10, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }}
                      tickFormatter={v => `${sym}${Math.round(Math.abs(v) / 1000)}k`} />
                    <Tooltip formatter={moneyTip('P/L')} />
                    <ReferenceLine y={0} stroke="#cbd5e1" strokeWidth={1} />
                    <Bar dataKey="pl" radius={[4, 4, 0, 0]} maxBarSize={52}>
                      {mpl.map((e, i) => <Cell key={i} fill={e.pl >= 0 ? C.profit : C.loss} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )
            }
          </Card>

          {/* 4 — P/L by Stock */}
          <Card title="P/L by Stock (Top 10)">
            {spl.length === 0
              ? <Empty msg="No closed trades yet" />
              : (
                <ResponsiveContainer width="100%" height={Math.max(200, spl.length * 34 + 24)}>
                  <BarChart data={spl} layout="vertical" margin={{ top: 0, right: 52, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                    <XAxis type="number" tick={{ fontSize: 10 }}
                      tickFormatter={v => `${sym}${Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(0) + 'k' : Math.abs(v)}`} />
                    <YAxis type="category" dataKey="stock" tick={{ fontSize: 11 }} width={72} />
                    <Tooltip formatter={moneyTip('P/L')} />
                    <ReferenceLine x={0} stroke="#cbd5e1" strokeWidth={1} />
                    <Bar dataKey="pl" radius={[0, 4, 4, 0]} maxBarSize={22}>
                      {spl.map((e, i) => <Cell key={i} fill={e.pl >= 0 ? C.profit : C.loss} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )
            }
          </Card>

          {/* 5 — Open allocation */}
          <Card title="Open Position Allocation (PF %)">
            {oa.length === 0
              ? <Empty msg="No open positions with portfolio % data" />
              : (
                <ResponsiveContainer width="100%" height={Math.max(200, oa.length * 34 + 24)}>
                  <BarChart data={oa} layout="vertical" margin={{ top: 0, right: 52, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
                    <YAxis type="category" dataKey="stock" tick={{ fontSize: 11 }} width={72} />
                    <Tooltip formatter={
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (v: any) => [`${v}%`, 'Portfolio %'] as [string, string]
                    } />
                    <Bar dataKey="pf" fill={C.blue} radius={[0, 4, 4, 0]} maxBarSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              )
            }
          </Card>

          {/* 6 — Trade duration */}
          <Card title="Trade Duration Distribution">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={dur} margin={{ top: 6, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip formatter={countTip('Trades')} />
                <Bar dataKey="count" fill={C.cyan} radius={[4, 4, 0, 0]} maxBarSize={52} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

        </div>
      )}
    </div>
  );
}
