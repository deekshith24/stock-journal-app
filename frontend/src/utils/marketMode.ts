import { Trade } from '../types';

function getRecentWinRate(trades: Trade[], n = 8): { winRate: number; count: number } | null {
  const recent = [...trades]
    .filter(t => t.status === 'Closed' && t.pl != null)
    .sort((a, b) => (b.exit_date ?? b.entry_date).localeCompare(a.exit_date ?? a.entry_date))
    .slice(0, n);
  if (recent.length < 4) return null;
  const wins = recent.filter(t => (t.pl ?? 0) > 0).length;
  return { winRate: (wins / recent.length) * 100, count: recent.length };
}

export function marketModeFromTrades(trades: Trade[]): 'choppy' | 'bull' | 'neutral' {
  const recent = getRecentWinRate(trades);
  if (!recent) return 'neutral';
  if (recent.winRate < 35) return 'choppy';
  if (recent.winRate >= 60) return 'bull';
  return 'neutral';
}
