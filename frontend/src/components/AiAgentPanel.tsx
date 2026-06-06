import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { Trade, Settings, StockPrice } from '../types';

interface Props {
  trades: Trade[];
  stockPrices: Record<string, StockPrice>;
  currency: 'INR' | 'USD';
  locale: string;
  market: 'india' | 'us';
  settings: Settings;
}

type Message = { role: 'user' | 'assistant'; text: string; source?: 'hf' | 'fallback' };

type Analysis = {
  totalTrades: number;
  openCount: number;
  partialCount: number;
  closedCount: number;
  totalPL: number;
  winRate: number | null;
  avgHoldDays: number | null;
  marketCondition: 'bull' | 'choppy' | 'neutral';
  stalledTrades: string[];
  partialCandidates: string[];
  highExposure: string[];
};

function fmtMoney(value: number, locale: string, symbol: string) {
  return `${symbol}${Math.abs(value).toLocaleString(locale, { maximumFractionDigits: 0 })}`;
}

function getMarketCondition(winRate: number | null) {
  if (winRate == null) return 'neutral';
  if (winRate >= 60) return 'bull';
  if (winRate < 35) return 'choppy';
  return 'neutral';
}

function buildAnalysis(trades: Trade[], stockPrices: Record<string, StockPrice>, currency: 'INR' | 'USD', locale: string, market: 'india' | 'us'): Analysis {
  const openTrades = trades.filter(t => t.status === 'Open');
  const partialTrades = trades.filter(t => t.status === 'Partial');
  const closedTrades = trades.filter(t => t.status === 'Closed');
  const totalPL = closedTrades.reduce((sum, t) => sum + (t.pl ?? 0), 0);
  const winRate = closedTrades.length > 0 ? (closedTrades.filter(t => (t.pl ?? 0) > 0).length / closedTrades.length) * 100 : null;
  const avgHoldDays = closedTrades.length > 0 ? closedTrades.reduce((sum, t) => sum + (parseInt(t.days_in_trade ?? '0') || 0), 0) / closedTrades.length : null;
  const marketCondition = getMarketCondition(winRate);
  const exchange = market === 'us' ? 'US' : 'IN';

  const stalledTrades = trades
    .filter(t => (t.status === 'Open' || t.status === 'Partial') && parseInt(t.days_in_trade ?? '0') > 10)
    .filter(t => {
      const currentPrice = stockPrices[`${t.stock}:${exchange}`]?.currentPrice;
      if (!currentPrice) return false;
      if (currentPrice <= t.entry_price) return true;
      const pct = Math.abs((currentPrice - t.entry_price) / t.entry_price) * 100;
      return pct <= 1;
    })
    .map(t => `${t.stock} (${t.days_in_trade})`)
    .slice(0, 5);

  const partialCandidates = trades
    .filter(t => (t.status === 'Open' || t.status === 'Partial') && Math.abs((t.entry_quantity - (t.exit_quantity ?? 0)) - t.entry_quantity) < 1e-6)
    .map(t => {
      const currentPrice = stockPrices[`${t.stock}:${exchange}`]?.currentPrice;
      if (!currentPrice) return null;
      const pct = ((currentPrice - t.entry_price) / t.entry_price) * 100;
      if (marketCondition === 'choppy' && pct >= 10) return `${t.stock} ${pct.toFixed(1)}%`;
      if (marketCondition === 'bull' && pct >= 15) return `${t.stock} ${pct.toFixed(1)}%`;
      if (marketCondition === 'neutral' && pct >= 12) return `${t.stock} ${pct.toFixed(1)}%`;
      return null;
    })
    .filter((item): item is string => Boolean(item))
    .slice(0, 5);

  const highExposure = trades
    .filter(t => (t.status === 'Open' || t.status === 'Partial') && (t.pf_percentage ?? 0) >= 5)
    .sort((a, b) => (b.pf_percentage ?? 0) - (a.pf_percentage ?? 0))
    .slice(0, 5)
    .map(t => `${t.stock} ${((t.pf_percentage ?? 0)).toFixed(1)}%`);

  return {
    totalTrades: trades.length,
    openCount: openTrades.length,
    partialCount: partialTrades.length,
    closedCount: closedTrades.length,
    totalPL,
    winRate,
    avgHoldDays,
    marketCondition,
    stalledTrades,
    partialCandidates,
    highExposure,
  };
}

function buildIntro(analysis: Analysis, currency: 'INR' | 'USD', locale: string) {
  const condition = analysis.marketCondition === 'bull'
    ? 'Bull market condition detected' 
    : analysis.marketCondition === 'choppy'
      ? 'Market looks choppy' 
      : 'Market is neutral';
  const status = `${analysis.openCount} open, ${analysis.partialCount} partial, ${analysis.closedCount} closed trades.`;
  const winRate = analysis.winRate != null ? `${analysis.winRate.toFixed(1)}% win rate` : 'not enough closed trades for win rate';
  const topStalled = analysis.stalledTrades.length ? `Stalled trades: ${analysis.stalledTrades.join(', ')}.` : 'No stalled trades identified right now.';
  const topPartial = analysis.partialCandidates.length ? `Partial book candidates: ${analysis.partialCandidates.join(', ')}.` : 'No immediate partial-book candidates at the current thresholds.';
  return `${condition}. ${status} ${winRate}. ${topStalled} ${topPartial} Ask me about market condition, stalled trades, partial booking, risk, or current trade health.`;
}

function generateResponse(question: string, analysis: Analysis, currency: 'INR' | 'USD', locale: string) {
  const text = question.toLowerCase();
  const symbol = currency === 'INR' ? '₹' : '$';
  const lines: string[] = [];

  if (text.includes('market') || text.includes('condition') || text.includes('regime')) {
    lines.push(`Market condition: ${analysis.marketCondition === 'bull' ? 'Bull' : analysis.marketCondition === 'choppy' ? 'Choppy' : 'Neutral'}.`);
    if (analysis.winRate != null) lines.push(`Win rate over closed trades is ${analysis.winRate.toFixed(1)}%`);
    if (analysis.marketCondition === 'choppy') lines.push('Reduce position size, avoid new entries, and watch for sideways behavior.');
    if (analysis.marketCondition === 'bull') lines.push('You can be more aggressive with partial booking targets, but keep stop losses disciplined.');
    return lines.join(' ');
  }

  if (text.includes('stalled') || text.includes('slow') || text.includes('time')) {
    if (analysis.stalledTrades.length) {
      lines.push(`Stalled trades: ${analysis.stalledTrades.join(', ')}.`);
      lines.push('These have been open over 10 trading days with little movement. Consider trimming or reviewing their thesis.');
    } else {
      lines.push('No stalled trades detected right now. Your open positions appear to be moving or are still within normal hold time.');
    }
    return lines.join(' ');
  }

  if (text.includes('partial') || text.includes('book 30') || text.includes('book partial')) {
    if (analysis.partialCandidates.length) {
      lines.push(`Book partial candidates: ${analysis.partialCandidates.join(', ')}.`);
      lines.push('For full positions, consider exiting roughly 30% on these names to lock gains while keeping exposure.');
    } else {
      lines.push('No strong partial-book candidates found with the current thresholds. Continue monitoring your open positions.');
    }
    return lines.join(' ');
  }

  if (text.includes('risk') || text.includes('exposure') || text.includes('danger')) {
    if (analysis.highExposure.length) {
      lines.push(`High exposure trades: ${analysis.highExposure.join(', ')}.`);
      lines.push('Watch these names closely and avoid adding more until the market confirms direction.');
    } else {
      lines.push('No large position exposures detected at the moment. Your risk is reasonably distributed across open positions.');
    }
    return lines.join(' ');
  }

  if (text.includes('summary') || text.includes('overview') || text.includes('how am i doing')) {
    lines.push(`You have ${analysis.totalTrades} trades in view: ${analysis.openCount} open, ${analysis.partialCount} partial, and ${analysis.closedCount} closed.`);
    if (analysis.winRate != null) lines.push(`Your win rate on closed trades is ${analysis.winRate.toFixed(1)}% and total P/L is ${fmtMoney(analysis.totalPL, locale, symbol)}.`);
    if (analysis.avgHoldDays != null) lines.push(`Average hold time on closed trades is ${analysis.avgHoldDays.toFixed(1)} trading days.`);
    return lines.join(' ');
  }

  lines.push('I can help with: market condition, stalled trades, partial booking suggestions, risk exposure, and trade summary.');
  lines.push('Try asking “What is the market condition?”, “Which trades are stalled?”, or “Should I book partial?”.');
  return lines.join(' ');
}

export default function AiAgentPanel({ trades, stockPrices, currency, locale, market, settings }: Props) {
  const analysis = useMemo(() => buildAnalysis(trades, stockPrices, currency, locale, market), [trades, stockPrices, currency, locale, market]);
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', text: buildIntro(analysis, currency, locale) }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);
  const [backendStatus, setBackendStatus] = useState<string | null>(null);

  const configuredApiUrl = import.meta.env.VITE_API_URL;
  const apiUrl = configuredApiUrl ?? window.location.origin;
  const apiBase = `${apiUrl.replace(/\/+$/, '')}/api`;
  const apiDebug = configuredApiUrl
    ? `Using configured backend host: ${apiUrl}`
    : `VITE_API_URL is not set; using current origin: ${apiUrl}`;
  const apiWarning = !configuredApiUrl ? 'Set VITE_API_URL in your frontend env to the backend host, for example https://stock-journal-app.onrender.com.' : null;

  useEffect(() => {
    const checkBackend = async () => {
      try {
        const statusRes = await fetch(`${apiBase}/ai/status`);
        if (!statusRes.ok) {
          setBackendStatus(`Backend status check failed: ${statusRes.status} ${statusRes.statusText}`);
          return;
        }
        const statusData = await statusRes.json();
        setBackendStatus(`Backend reachable: ${statusData.ai_enabled ? 'yes' : 'no'}; model=${statusData.model}; token=${statusData.hf_token_present ? 'present' : 'missing'}`);
      } catch (statusError: unknown) {
        setBackendStatus(`Backend status fetch failed: ${statusError instanceof Error ? statusError.message : String(statusError)}`);
      }
    };

    void checkBackend();
  }, [apiBase]);

  const askAssistant = async (question: string) => {
    if (!question.trim()) return;
    setError(null);
    setMessages(prev => [...prev, { role: 'user', text: question }]);
    setLoading(true);

    const configuredApiUrl = import.meta.env.VITE_API_URL;
    if (!configuredApiUrl) {
      console.warn('VITE_API_URL is not set. Using frontend origin as API host. If backend is hosted separately, set VITE_API_URL to the backend URL.');
    }
    const apiUrl = configuredApiUrl ?? window.location.origin;
    const apiBase = `${apiUrl.replace(/\/+$/, '')}/api`;
    const endpoint = `${apiBase}/ai/analysis`;
    console.log('AI assistant request URL:', endpoint);

    try {
      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token;
      const sessionDetails = session.data?.session;
      setDebugInfo(`Endpoint: ${endpoint}\nAuth token present: ${Boolean(accessToken)}\nSession present: ${Boolean(sessionDetails)}\nUser ID: ${sessionDetails?.user?.id ?? 'none'}\nUser email: ${sessionDetails?.user?.email ?? 'unknown'}`);
      if (!accessToken) {
        const authError = 'Unauthorized: no Supabase access token found. Please sign in again.';
        setError(authError);
        setLoading(false);
        return;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ market, question, trades }),
      });

      if (!response.ok) {
        const body = await response.text();
        const message = body ? `${response.status} ${response.statusText}: ${body}` : `${response.status} ${response.statusText}`;
        if (response.status === 401) {
          throw new Error(`Unauthorized: backend rejected your Supabase token. Try signing out and signing back in. (${message})`);
        }
        throw new Error(message);
      }

      const data = await response.json() as { answer: string; source: 'hf' | 'fallback'; ai_connected: boolean; error?: string; hf_token_present?: boolean; model?: string };
      const assistantText = data.answer || generateResponse(question, analysis, currency, locale);
      setMessages(prev => [...prev, { role: 'assistant', text: assistantText, source: data.source }]);
      if (!data.ai_connected) {
        setError(data.error || 'AI connection is unavailable; using static analysis fallback.');
      }
    } catch (err: unknown) {
      const fallback = generateResponse(question, analysis, currency, locale);
      setMessages(prev => [...prev, { role: 'assistant', text: fallback, source: 'fallback' }]);
      const rawMessage = err instanceof Error ? err.message : String(err);
      console.error('AI assistant fetch error:', rawMessage, { endpoint });
      const normalized = rawMessage.toLowerCase();
      if (normalized.includes('fetch') || normalized.includes('network')) {
        setError(`Cannot reach AI backend at ${endpoint}. Error: ${rawMessage}. Check VITE_API_URL and backend availability.`);
      } else {
        setError(`${rawMessage} (endpoint: ${endpoint})`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = input.trim();
    if (!question) return;
    setInput('');
    await askAssistant(question);
  };

  const quickButtons = [
    'What is the market condition?',
    'Which trades are stalled?',
    'Should I book partial?',
    'Where is my highest exposure?',
    'Give me a trade summary',
  ];

  return (
    <div style={{ border: '1px solid #dde2ea', borderRadius: 12, padding: 16, marginTop: 20, background: '#ffffff' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Journal Assistant</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Ask about market condition, partial booking, stalled trades, or risk.</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#1f2937', background: '#ecfdf5', borderRadius: 999, padding: '4px 10px' }}>{market === 'india' ? 'India' : 'US'}</span>
          <span style={{ fontSize: 12, color: '#1f2937', background: '#eef2ff', borderRadius: 999, padding: '4px 10px' }}>{currency}</span>
        </div>
      </div>
      <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: '#eef2ff', color: '#1d4ed8', fontSize: 12 }}>
        {apiDebug}
      </div>
      {apiWarning && (
        <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: '#fef3c7', color: '#92400e', fontSize: 12 }}>
          {apiWarning}
        </div>
      )}
      {backendStatus && (
        <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: '#eef2ff', color: '#1e3a8a', fontSize: 12, whiteSpace: 'pre-wrap' }}>
          {backendStatus}
        </div>
      )}
      {debugInfo && (
        <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: '#eef2ff', color: '#1e3a8a', fontSize: 12, whiteSpace: 'pre-wrap' }}>
          {debugInfo}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {quickButtons.map(btn => (
          <button
            key={btn}
            type="button"
            onClick={() => void askAssistant(btn)}
            disabled={loading}
            style={{ background: '#f8fafc', border: '1px solid #d1d5db', borderRadius: 999, padding: '6px 10px', fontSize: 12, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}
          >
            {btn}
          </button>
        ))}
      </div>

      <div style={{ maxHeight: 320, overflowY: 'auto', padding: 10, border: '1px solid #e5e7eb', borderRadius: 10, background: '#f8fafc' }}>
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: message.role === 'assistant' ? '#2563eb' : '#6b7280', color: '#ffffff', display: 'grid', placeItems: 'center', fontSize: 12 }}>{message.role === 'assistant' ? 'A' : 'U'}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: message.role === 'assistant' ? '#1f2937' : '#374151' }}>{message.role === 'assistant' ? 'Assistant' : 'You'}</div>
            </div>
            <div style={{ marginTop: 6, padding: 12, borderRadius: 12, background: message.role === 'assistant' ? '#ffffff' : '#e2e8f0', whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5, color: '#111827' }}>
              {message.text}
              {message.role === 'assistant' && message.source && (
                <div style={{ marginTop: 10, fontSize: 11, color: '#6b7280' }}>
                  Source: {message.source === 'hf' ? 'AI' : 'Static analysis'}{message.source === 'fallback' ? ' (fallback)' : ''}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {error && (
        <div style={{ marginTop: 8, padding: 10, borderRadius: 10, background: '#fee2e2', color: '#991b1b', fontSize: 12 }}>
          {error}
        </div>
      )}
      <form onSubmit={handleSend} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask the journal assistant..."
          disabled={loading}
          style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 13, background: loading ? '#f3f4f6' : '#ffffff' }}
        />
        <button type="submit" disabled={loading} style={{ background: '#2563eb', color: '#ffffff', border: 'none', borderRadius: 10, padding: '10px 16px', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Thinking…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
