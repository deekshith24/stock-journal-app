import React, { useState, useEffect, useCallback } from 'react';
import { Trade, Settings, ExitRecord, StockPrice, ActivityEntry } from './types';
import { api } from './api';
import { supabase } from './supabaseClient';
import { exportToExcel } from './utils/exportExcel';
import { marketModeFromTrades } from './utils/marketMode';
import TradeTable from './components/TradeTable';
import TradeForm from './components/TradeForm';
import SummaryCards from './components/SummaryCards';
import SettingsModal from './components/SettingsModal';
import ClosePositionModal from './components/ClosePositionModal';
import GroupCloseModal, { GroupExit } from './components/GroupCloseModal';
import TradeDetailModal from './components/TradeDetailModal';
import SmartAlerts from './components/SmartAlerts';
import AnalyticsPage from './components/AnalyticsPage';
import ActivityLogPage from './components/ActivityLogPage';
import AiAgentPanel from './components/AiAgentPanel';
import LoginPage from './components/LoginPage';
import FaceIDSetup from './components/FaceIDSetup';
import FaceIDPrompt from './components/FaceIDPrompt';

type FilterType = 'all' | 'open' | 'closed';
type PageType = 'india' | 'us' | 'analytics' | 'activity';
type TradeTypeTab = 'swing' | 'positional' | 'intraday_short';
type UsCurrency = 'USD' | 'INR';
type PeriodFilter = '1M' | '3M' | '6M' | '1Y' | 'ALL' | 'CUSTOM';

const PERIOD_OPTIONS: { label: string; value: PeriodFilter; days: number }[] = [
  { label: '1M',     value: '1M',     days: 30  },
  { label: '3M',     value: '3M',     days: 90  },
  { label: '6M',     value: '6M',     days: 180 },
  { label: '1Y',     value: '1Y',     days: 365 },
  { label: 'All',    value: 'ALL',    days: 0   },
  { label: 'Custom', value: 'CUSTOM', days: 0   },
];

const USD_INR_RATE_CACHE_KEY  = 'usdToInrRateCache';
const STOCK_PRICE_CACHE_KEY   = 'stockPriceCache';
const STOCK_PRICE_CACHE_VERSION = '2';  // bump to bust stale FMP-era cache

// Bust old cache if it was built with a different version
(function bustOldCache() {
  const v = window.localStorage.getItem('stockPriceCacheVersion');
  if (v !== STOCK_PRICE_CACHE_VERSION) {
    window.localStorage.removeItem(STOCK_PRICE_CACHE_KEY);
    window.localStorage.setItem('stockPriceCacheVersion', STOCK_PRICE_CACHE_VERSION);
  }
})();

function loadUsdToInrRateCache(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(USD_INR_RATE_CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveUsdToInrRateCache(rates: Record<string, number>) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(USD_INR_RATE_CACHE_KEY, JSON.stringify(rates));
}

function getLatestUsdToInrInfo(rates: Record<string, number>) {
  const dates = Object.keys(rates).sort();
  if (!dates.length) return { rate: undefined as number | undefined, date: undefined as string | undefined };
  const lastDate = dates[dates.length - 1];
  return { rate: rates[lastDate], date: lastDate };
}

function topTextSuggestions(values: Array<string | undefined | null>, maxItems = 10): string[] {
  const counts = values.filter(Boolean).reduce<Record<string, number>>((acc, value) => {
    const normalized = (value || '').trim();
    if (!normalized) return acc;
    acc[normalized] = (acc[normalized] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxItems)
    .map(([value]) => value);
}

// Stock price cache — keyed by "SYMBOL:EXCHANGE"
// Each entry stores { price, fetchedAt (ISO string) }
interface CachedPrice { price: StockPrice; fetchedAt: string; }

function loadStockPriceCache(): Record<string, CachedPrice> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STOCK_PRICE_CACHE_KEY) || '{}');
    // Drop any entries with invalid prices
    return Object.fromEntries(
      Object.entries(raw).filter(([, v]) => {
        const p = (v as CachedPrice)?.price?.currentPrice;
        return typeof p === 'number' && isFinite(p) && p > 0;
      })
    ) as Record<string, CachedPrice>;
  } catch { return {}; }
}

function saveStockPriceCache(cache: Record<string, CachedPrice>) {
  window.localStorage.setItem(STOCK_PRICE_CACHE_KEY, JSON.stringify(cache));
}

// Returns true when a cached price entry needs a fresh fetch.
// Prices refresh after each market's daily close:
//   India (NSE): 10:00 UTC = 15:30 IST
//   US (NYSE/NASDAQ): 21:00 UTC = 16:00 ET
function isPriceStale(entry: CachedPrice, exchange: string): boolean {
  const fetchedAt = new Date(entry.fetchedAt);
  const now       = new Date();
  const todayStr  = now.toISOString().slice(0, 10);
  const closeUTC  = exchange === 'US' ? 21 : 10; // hour in UTC

  // Build today's close time in UTC
  const todayClose = new Date(`${todayStr}T${String(closeUTC).padStart(2, '0')}:00:00Z`);

  if (now < todayClose) {
    // Market not yet closed today — use yesterday's close data; stale if fetched before yesterday's close
    const yesterday = new Date(todayClose);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    return fetchedAt < yesterday;
  }
  // Market closed today — stale if not fetched after today's close
  return fetchedAt < todayClose;
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [faceIdState, setFaceIdState] = useState<'checking' | 'prompt' | 'setup' | 'done'>('checking');
  const [webauthnCredentialId, setWebauthnCredentialId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<PageType>('india');
  const [tradeTypeTab, setTradeTypeTab] = useState<TradeTypeTab>('swing');
  const [usCurrency, setUsCurrency] = useState<UsCurrency>('USD');

  const [indiaTrades, setIndiaTrades] = useState<Trade[]>([]);
  const [usTrades, setUsTrades] = useState<Trade[]>([]);
  const [settings, setSettings] = useState<Settings>({ portfolio_size: 300000, us_portfolio_size: 50000, usd_to_inr: 84 });

  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<PeriodFilter>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activityEntries, setActivityEntries] = useState<ActivityEntry[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [addPositionStock, setAddPositionStock] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Trade | null>(null);
  const [closingTrade, setClosingTrade] = useState<Trade | null>(null);
  const [closingGroup, setClosingGroup] = useState<{ stock: string; trades: Trade[] } | null>(null);
  const [viewingTrade, setViewingTrade] = useState<Trade | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [dateRates, setDateRates] = useState<Record<string, number>>(() => loadUsdToInrRateCache());
  const [lastUsdToInrRate, setLastUsdToInrRate] = useState<number | undefined>(() => getLatestUsdToInrInfo(loadUsdToInrRateCache()).rate);
  const [lastUsdToInrRateDate, setLastUsdToInrRateDate] = useState<string | undefined>(() => getLatestUsdToInrInfo(loadUsdToInrRateCache()).date);
  const [stockPrices, setStockPrices] = useState<Record<string, StockPrice>>({});
  const [maskPrices, setMaskPrices] = useState(false);
  const [lastPriceFetchedAt, setLastPriceFetchedAt] = useState<Date | null>(() => {
    const cache = loadStockPriceCache();
    const times = Object.values(cache).map(e => new Date(e.fetchedAt).getTime());
    return times.length ? new Date(Math.max(...times)) : null;
  });

  const isUS = currentPage === 'us';

  useEffect(() => {
    const API = import.meta.env.VITE_API_URL ?? '';

    async function initAuth(uid: string, email: string | null) {
      setUserId(uid);
      setUserEmail(email);
      if (sessionStorage.getItem('faceIdVerified') === uid) {
        setFaceIdState('done');
        return;
      }
      if (import.meta.env.VITE_SKIP_WEBAUTHN === 'true') {
        sessionStorage.setItem('faceIdVerified', uid);
        setFaceIdState('done');
        return;
      }
      try {
        const res = await fetch(`${API}/api/webauthn/get-credential`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: uid }),
        });
        const { credentialId } = await res.json();
        setWebauthnCredentialId(credentialId ?? null);
        setFaceIdState(credentialId ? 'prompt' : 'setup');
      } catch {
        setFaceIdState('setup');
      }
    }

    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session;
      setLoggedIn(!!session);
      if (session?.user) {
        await initAuth(session.user.id, session.user.email ?? null);
      }
      setAuthReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setLoggedIn(!!session);
      if (session?.user) {
        setUserId(session.user.id);
        setUserEmail(session.user.email ?? null);
        // Only re-check on fresh OAuth sign-in, not on token refreshes
        if (_event === 'SIGNED_IN') {
          initAuth(session.user.id, session.user.email ?? null);
        }
      } else {
        setWebauthnCredentialId(null);
        setFaceIdState('checking');
      }
    });
    return () => subscription.unsubscribe();
  }, []);
  const isAnalytics = currentPage === 'analytics';
  const trades = isUS ? usTrades : indiaTrades;
  const setTrades = isUS ? setUsTrades : setIndiaTrades;

  const allTrades = [...indiaTrades, ...usTrades];
  const entryReasonSuggestions = topTextSuggestions(allTrades.map(t => t.reason_for_entry));
  const exitReasonSuggestions = topTextSuggestions([
    ...allTrades.map(t => t.reason_for_exit),
    ...allTrades.flatMap(t => t.exits?.map(e => e.reason) ?? []),
  ]);
  const emotionSuggestions = topTextSuggestions([
    ...allTrades.map(t => t.emotions),
    ...allTrades.flatMap(t => t.exits?.map(e => e.emotions) ?? []),
  ]);

  // Currency display logic
  const hasUsdToInrRate = Boolean(lastUsdToInrRate);
  const displayCurrency = isUS && usCurrency === 'INR' && hasUsdToInrRate ? 'INR' : isUS ? 'USD' : 'INR';
  const exchangeRate = isUS && displayCurrency === 'INR' ? lastUsdToInrRate : undefined;
  const sym = displayCurrency === 'INR' ? '₹' : '$';
  const locale = displayCurrency === 'INR' ? 'en-IN' : 'en-US';
  const isJournalPage = currentPage === 'india' || currentPage === 'us';
  const portfolioSize = isUS
    ? displayCurrency === 'INR'
      ? settings.us_portfolio_size * (lastUsdToInrRate || 1)
      : settings.us_portfolio_size
    : settings.portfolio_size;
  const tenPercentCapital = portfolioSize * 0.1;

  const loadData = useCallback(async () => {
    try {
      const [indiaData, usData, settingsData] = await Promise.all([
        api.getTrades(),
        api.getUsTrades(),
        api.getSettings(),
      ]);
      setIndiaTrades(indiaData);
      setUsTrades(usData);
      setSettings(settingsData);
      setError(null);

      const cachedRates = loadUsdToInrRateCache();
      const todayDate = new Date().toISOString().slice(0, 10);
      const tradeEntryDates = Array.from(new Set(usData.map(t => t.entry_date)));
      const dates = Array.from(new Set([...tradeEntryDates, todayDate]));
      const missingDates = dates.filter(date => !cachedRates[date]);
      const fetchedEntries = await Promise.all(missingDates.map(async date => {
        try {
          const result = await api.getUsdToInrRate(date);
          return [date, result.rate] as const;
        } catch {
          return null;
        }
      }));
      const fetchedRates = Object.fromEntries(fetchedEntries.filter((entry): entry is readonly [string, number] => entry !== null));
      const updatedRates = { ...cachedRates, ...fetchedRates };
      setDateRates(updatedRates);
      const latest = getLatestUsdToInrInfo(updatedRates);
      setLastUsdToInrRate(latest.rate);
      setLastUsdToInrRateDate(latest.date);
      saveUsdToInrRateCache(updatedRates);

      // Fetch stock prices for open/partial positions — with daily market-close cache
      const indiaOpenPositions = indiaData.filter(t => t.status === 'Open' || t.status === 'Partial').map(t => ({ ...t, _exchange: 'IN' as const }));
      const usOpenPositions = usData.filter(t => t.status === 'Open' || t.status === 'Partial').map(t => ({ ...t, _exchange: 'US' as const }));
      const allOpenPositions = [...indiaOpenPositions, ...usOpenPositions];
      const uniqueStocks = Array.from(new Set(allOpenPositions.map(t => `${t.stock}:${t._exchange}`)));

      const priceCache = loadStockPriceCache();
      const stockPricePromises = uniqueStocks.map(async (stockKey) => {
        const [symbol, exchange] = stockKey.split(':');
        const cached = priceCache[stockKey];
        // Use cache if price is still fresh for this exchange's market close
        if (cached && !isPriceStale(cached, exchange)) {
          return [stockKey, cached.price] as const;
        }
        try {
          const price = await api.getStockPrice(symbol, exchange);
          priceCache[stockKey] = { price, fetchedAt: new Date().toISOString() };
          return [stockKey, price] as const;
        } catch {
          // Fall back to stale cache if available
          if (cached) return [stockKey, cached.price] as const;
          return null;
        }
      });
      const stockPriceResults = await Promise.all(stockPricePromises);
      const newStockPrices = Object.fromEntries(stockPriceResults.filter((entry): entry is readonly [string, StockPrice] => entry !== null));
      saveStockPriceCache(priceCache);
      // Merge into existing prices so failed fetches don't blank out current P/L values
      setStockPrices(prev => ({ ...prev, ...newStockPrices }));
      const fetchTimes = Object.values(priceCache).map(e => new Date(e.fetchedAt).getTime());
      if (fetchTimes.length) setLastPriceFetchedAt(new Date(Math.max(...fetchTimes)));
    } catch (e) {
      setError('Failed to load data. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const loadActivity = useCallback(async () => {
    try {
      const entries = await api.getActivity();
      setActivityEntries(entries);
    } catch {
      // silently ignore — activity log is non-critical
    }
  }, []);

  useEffect(() => {
    if (currentPage === 'activity') loadActivity();
  }, [currentPage, loadActivity]);

  const handlePageSwitch = (page: PageType) => {
    setCurrentPage(page);
    setTradeTypeTab('swing');
    setFilter('all');
    setSearch('');
    setPeriod('ALL');
    setDateFrom('');
    setDateTo('');
  };

  const fromDate = (() => {
    if (period === 'ALL') return '';
    if (period === 'CUSTOM') return dateFrom;
    const days = PERIOD_OPTIONS.find(o => o.value === period)!.days;
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  })();
  const toDate = period === 'CUSTOM' ? dateTo : '';

  const dateFilter = (t: Trade) =>
    (!fromDate || t.entry_date >= fromDate) &&
    (!toDate   || t.entry_date <= toDate);

  const isSwing         = (t: Trade) => t.trade_type === 'swing' || !t.trade_type;
  const isPositional    = (t: Trade) => t.trade_type === 'positional';
  const isIntradayShort = (t: Trade) => t.trade_type === 'intraday_short';

  const allDateFilteredTrades            = trades.filter(dateFilter);
  const swingDateFilteredTrades          = trades.filter(t => dateFilter(t) && isSwing(t));
  const positionalDateFilteredTrades     = trades.filter(t => dateFilter(t) && isPositional(t));
  const intradayShortDateFilteredTrades  = trades.filter(t => dateFilter(t) && isIntradayShort(t));

  const dateFilteredTrades = tradeTypeTab === 'swing' ? swingDateFilteredTrades
    : tradeTypeTab === 'positional' ? positionalDateFilteredTrades
    : intradayShortDateFilteredTrades;

  const filteredTrades = dateFilteredTrades.filter(t => {
    const matchesFilter =
      filter === 'all' ||
      (filter === 'open' && (t.status === 'Open' || t.status === 'Partial')) ||
      (filter === 'closed' && t.status === 'Closed');
    const matchesSearch = !search || t.stock.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  }).sort((a, b) => {
    const d = new Date(b.entry_date).getTime() - new Date(a.entry_date).getTime();
    return d !== 0 ? d : (b.id ?? 0) - (a.id ?? 0);
  });

  const handleSave = async (data: { stock: string; trade_type: 'swing' | 'positional' | 'intraday_short'; entry_date: string; entry_quantity: number; entry_price: number; reason_for_entry: string }, exits?: ExitRecord[]) => {
    try {
      if (editingTrade?.id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (isUS ? api.updateUsTrade(editingTrade.id, data as any) : api.updateTrade(editingTrade.id, data as any));
        if (exits !== undefined) {
          await (isUS ? api.updateUsExits(editingTrade.id, exits) : api.updateExits(editingTrade.id, exits));
        }
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (isUS ? api.createUsTrade(data as any) : api.createTrade(data as any));
      }
      setShowForm(false);
      setEditingTrade(null);
      loadData();
    } catch (e: unknown) {
      alert((e as Error).message || 'Save failed');
    }
  };

  const handleEdit = (trade: Trade) => {
    setEditingTrade(trade);
    setAddPositionStock(null);
    setShowForm(true);
  };

  const handleAddPosition = (stock: string) => {
    setEditingTrade(null);
    setAddPositionStock(stock);
    setShowForm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm?.id) return;
    try {
      if (isUS) {
        await api.deleteUsTrade(deleteConfirm.id);
      } else {
        await api.deleteTrade(deleteConfirm.id);
      }
      setDeleteConfirm(null);
      loadData();
    } catch (e: unknown) {
      alert((e as Error).message || 'Delete failed');
    }
  };

  const handleSaveSettings = async (s: Settings) => {
    const updated = await api.updateSettings(s);
    setSettings(updated);
    setShowSettings(false);
    loadData();
  };

  const handleClosePosition = async (exit: ExitRecord) => {
    if (!closingTrade?.id) return;
    try {
      await (isUS ? api.addUsExit(closingTrade.id, exit) : api.addExit(closingTrade.id, exit));
      setClosingTrade(null);
      loadData();
    } catch (e: unknown) {
      alert((e as Error).message || 'Close failed');
    }
  };

  const handleCloseGroup = async (exits: GroupExit[]) => {
    try {
      await Promise.all(exits.map(({ tradeId, exit }) =>
        isUS ? api.addUsExit(tradeId, exit) : api.addExit(tradeId, exit)
      ));
      setClosingGroup(null);
      loadData();
    } catch (e: unknown) {
      alert((e as Error).message || 'Close failed');
    }
  };

  const handleUpdateGroupSL = async (groupTrades: Trade[], stopLoss: number | null) => {
    try {
      await Promise.all(groupTrades.map(t =>
        isUS ? api.updateUsTrade(t.id!, { stop_loss: stopLoss } as any) : api.updateTrade(t.id!, { stop_loss: stopLoss } as any)
      ));
      loadData();
    } catch (e: unknown) {
      alert((e as Error).message || 'Failed to update stop loss');
    }
  };

  const handleConvertToPositional = async (trade: Trade) => {
    if (!trade.id) return;
    try {
      await (isUS ? api.updateUsTrade(trade.id, { trade_type: 'positional' } as any) : api.updateTrade(trade.id, { trade_type: 'positional' } as any));
      loadData();
    } catch (e: unknown) {
      alert((e as Error).message || 'Failed to convert trade type');
    }
  };

  const handleExport = () => {
    exportToExcel(indiaTrades, usTrades, lastUsdToInrRate ?? 0);
  };

  const handleRefreshPrices = () => {
    window.localStorage.removeItem(STOCK_PRICE_CACHE_KEY);
    loadData();
  };

  // Lock body scroll when any modal is open — prevents background scroll on iOS/Android
  const anyModalOpen = showForm || showSettings || !!deleteConfirm || !!closingTrade || !!closingGroup || !!viewingTrade;
  useEffect(() => {
    if (anyModalOpen) {
      const scrollY = window.scrollY;
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
    } else {
      const top = document.body.style.top;
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      if (top) window.scrollTo(0, -parseInt(top, 10));
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
    };
  }, [anyModalOpen]);

  // Auto-refresh prices after each market's daily close
  useEffect(() => {
    const id = setInterval(() => {
      const priceCache = loadStockPriceCache();
      const hasStale = Object.entries(priceCache).some(([key, entry]) => {
        const exchange = key.split(':')[1];
        return isPriceStale(entry, exchange);
      });
      if (hasStale) loadData();
    }, 60_000);
    return () => clearInterval(id);
  }, [loadData]);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#6c757d' }}>
      Loading…
    </div>
  );

  if (!authReady) return null;
  if (!loggedIn) return <LoginPage />;
  if (faceIdState === 'checking') return null;

  if (faceIdState === 'prompt' && userId) {
    return (
      <FaceIDPrompt
        userId={userId}
        onSuccess={() => { sessionStorage.setItem('faceIdVerified', userId!); setFaceIdState('done'); }}
        onCredentialNotFound={() => {
          setWebauthnCredentialId(null);
          setFaceIdState('setup');
        }}
      />
    );
  }
  if (faceIdState === 'setup' && userId) {
    return (
      <FaceIDSetup
        userId={userId}
        userName={userEmail ?? userId}
        onDone={(credentialId) => {
          sessionStorage.setItem('faceIdVerified', userId!);
          setWebauthnCredentialId(credentialId);
          setFaceIdState('done');
        }}
      />
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1>
            {isAnalytics ? '📊 Stock Journal — Analytics' : currentPage === 'activity' ? '📋 Stock Journal — Activity' : isUS ? '🇺🇸 Stock Journal — US' : '🇮🇳 Stock Journal — India'}
          </h1>
          <div className="page-tabs">
            <button className={`page-tab ${currentPage === 'india' ? 'active' : ''}`} onClick={() => handlePageSwitch('india')}>
              India
            </button>
            <button className={`page-tab ${currentPage === 'us' ? 'active' : ''}`} onClick={() => handlePageSwitch('us')}>
              US
            </button>
            <button className={`page-tab ${currentPage === 'analytics' ? 'active' : ''}`} onClick={() => handlePageSwitch('analytics')}>
              Analytics
            </button>
            <button className={`page-tab ${currentPage === 'activity' ? 'active' : ''}`} onClick={() => handlePageSwitch('activity')}>
              Activity
            </button>
          </div>
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost" onClick={() => setMaskPrices((m: boolean) => !m)} title={maskPrices ? 'Show prices' : 'Hide prices'}>
            {maskPrices ? '👁' : '🙈'}
          </button>
          <button className="btn btn-ghost" onClick={handleExport} title="Export all trades to Excel">
            ↓ Export
          </button>
          <button className="btn btn-ghost" onClick={() => setShowSettings(true)}>⚙ Settings</button>
          <button className="btn btn-ghost" onClick={() => { sessionStorage.removeItem('faceIdVerified'); supabase.auth.signOut(); setFaceIdState('checking'); }} title="Sign out">Sign out</button>
        </div>
      </header>

      <main className={`main-content${maskPrices ? ' prices-masked' : ''}`}>
        {error && (
          <div style={{ background: '#fee2e2', color: '#991b1b', padding: '12px 16px', borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
            ⚠ {error}
          </div>
        )}

        {isAnalytics ? (
          <AnalyticsPage
            indiaTrades={indiaTrades}
            usTrades={usTrades}
            stockPrices={stockPrices}
            settings={settings}
          />
        ) : currentPage === 'activity' ? (
          <ActivityLogPage entries={activityEntries} />
        ) : (
          <>
            {/* Overall summary */}
            <SummaryCards
              trades={allDateFilteredTrades}
              currency={displayCurrency}
              exchangeRate={exchangeRate}
              dateRates={dateRates}
              stockPrices={stockPrices}
              exchange={isUS ? 'US' : 'IN'}
              portfolioSize={portfolioSize}
              title="Overall"
              marketMode={marketModeFromTrades(allDateFilteredTrades)}
            />

            {/* Individual compact summary for active tab */}
            <SummaryCards
              trades={dateFilteredTrades}
              currency={displayCurrency}
              exchangeRate={exchangeRate}
              dateRates={dateRates}
              stockPrices={stockPrices}
              exchange={isUS ? 'US' : 'IN'}
              title={tradeTypeTab === 'swing' ? 'Swing Trade' : tradeTypeTab === 'positional' ? 'Positional Trade' : 'Intraday Short'}
              marketMode={marketModeFromTrades(dateFilteredTrades)}
              compact
            />

            <SmartAlerts trades={trades} />

            <div className="sub-tabs">
              <button
                className={`sub-tab ${tradeTypeTab === 'swing' ? 'active' : ''}`}
                onClick={() => { setTradeTypeTab('swing'); setFilter('all'); setSearch(''); setPeriod('ALL'); setDateFrom(''); setDateTo(''); }}
              >
                Swing Trade
              </button>
              <button
                className={`sub-tab ${tradeTypeTab === 'positional' ? 'active' : ''}`}
                onClick={() => { setTradeTypeTab('positional'); setFilter('all'); setSearch(''); setPeriod('ALL'); setDateFrom(''); setDateTo(''); }}
              >
                Positional Trade
              </button>
              <button
                className={`sub-tab ${tradeTypeTab === 'intraday_short' ? 'active' : ''}`}
                onClick={() => { setTradeTypeTab('intraday_short'); setFilter('all'); setSearch(''); setPeriod('ALL'); setDateFrom(''); setDateTo(''); }}
              >
                Intraday Short
              </button>
              <div className="sub-tabs-spacer" />
              <button className="btn btn-primary btn-sm" onClick={() => { setEditingTrade(null); setShowForm(true); }}>
                + Add Trade
              </button>
            </div>

            <div className="price-bar">
              <span className="price-bar-label">
                {lastPriceFetchedAt
                  ? `Prices as of ${lastPriceFetchedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${lastPriceFetchedAt.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })}`
                  : 'Prices not yet loaded'}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={handleRefreshPrices}>↺ Refresh</button>
            </div>

            <div className="toolbar">
              <div className="filter-tabs">
                {(['all', 'open', 'closed'] as FilterType[]).map(f => (
                  <button key={f} className={`tab-btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
                    {f === 'all'
                      ? `All (${dateFilteredTrades.length})`
                      : f === 'open'
                      ? `Open (${dateFilteredTrades.filter(t => t.status === 'Open' || t.status === 'Partial').length})`
                      : `Closed (${dateFilteredTrades.filter(t => t.status === 'Closed').length})`}
                  </button>
                ))}
              </div>
              <div className="filter-tabs">
                {PERIOD_OPTIONS.map(o => (
                  <button key={o.value} className={`tab-btn ${period === o.value ? 'active' : ''}`} onClick={() => setPeriod(o.value)}>
                    {o.label}
                  </button>
                ))}
              </div>
              {period === 'CUSTOM' && (
                <div className="date-range-inputs">
                  <input
                    type="date"
                    className="date-input"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                  />
                  <span style={{ color: '#9aa3af', fontSize: 12 }}>–</span>
                  <input
                    type="date"
                    className="date-input"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                  />
                </div>
              )}
              <input
                className="search-box"
                placeholder="Search stock…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />

              {isUS && (
                <>
                  <div className="currency-toggle">
                    <button
                      className={`toggle-btn ${usCurrency === 'USD' ? 'active' : ''}`}
                      onClick={() => setUsCurrency('USD')}
                    >
                      $ USD
                    </button>
                    <button
                      className={`toggle-btn ${usCurrency === 'INR' ? 'active' : ''}`}
                      onClick={() => setUsCurrency('INR')}
                      disabled={!lastUsdToInrRate}
                      title={!lastUsdToInrRate ? 'USD→INR rate not available yet' : undefined}
                    >
                      ₹ INR
                    </button>
                  </div>
                  <span style={{ color: '#6c757d', fontSize: 12, marginLeft: 12 }}>
                    {lastUsdToInrRate
                      ? `USD→INR: ₹${lastUsdToInrRate.toFixed(2)}${lastUsdToInrRateDate ? ` (${lastUsdToInrRateDate})` : ''}`
                      : 'USD→INR rate unavailable'}
                  </span>
                </>
              )}

              <div className="spacer" />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                <span style={{ fontSize: 11, color: '#6c757d' }}>
                  Portfolio: {sym}{portfolioSize.toLocaleString(locale)}
                </span>
                <span style={{ fontSize: 11, color: '#0f766e' }}>
                  10% capital: {sym}{tenPercentCapital.toLocaleString(locale, { maximumFractionDigits: 0 })}
                </span>
              </div>
            </div>

            <TradeTable
              trades={filteredTrades}
              currency={displayCurrency}
              exchange={isUS ? 'US' : 'IN'}
              exchangeRate={exchangeRate}
              dateRates={dateRates}
              stockPrices={stockPrices}
              portfolioSize={portfolioSize}
              onEdit={handleEdit}
              onClose={t => setClosingTrade(t)}
              onCloseGroup={(stock, trades) => setClosingGroup({ stock, trades })}
              onDelete={t => setDeleteConfirm(t)}
              onAddPosition={handleAddPosition}
              onView={t => setViewingTrade(t)}
              onUpdateGroupSL={handleUpdateGroupSL}
              onConvertToPositional={handleConvertToPositional}
            />
          </>
        )}
      </main>

      {showForm && (
        <TradeForm
          trade={editingTrade}
          defaultTradeType={editingTrade?.trade_type ?? tradeTypeTab}
          currency={isUS ? 'USD' : 'INR'}
          initialStock={addPositionStock ?? undefined}
          entryReasonSuggestions={entryReasonSuggestions}
          exitReasonSuggestions={exitReasonSuggestions}
          emotionSuggestions={emotionSuggestions}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditingTrade(null); setAddPositionStock(null); }}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          currentUsdToInr={lastUsdToInrRate}
          currentUsdToInrDate={lastUsdToInrRateDate}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Confirm Delete</h2>
              <button className="modal-close" onClick={() => setDeleteConfirm(null)}>×</button>
            </div>
            <div className="confirm-body">
              Delete trade for <strong>{deleteConfirm.stock}</strong>?<br />
              This action cannot be undone.
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDeleteConfirm}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {closingTrade && (
        <ClosePositionModal
          trade={closingTrade}
          currency={isUS ? 'USD' : 'INR'}
          exchangeRate={isUS ? lastUsdToInrRate : undefined}
          exitReasonSuggestions={exitReasonSuggestions}
          emotionSuggestions={emotionSuggestions}
          onSave={handleClosePosition}
          onClose={() => setClosingTrade(null)}
        />
      )}

      {closingGroup && (
        <GroupCloseModal
          stock={closingGroup.stock}
          trades={closingGroup.trades}
          currency={isUS ? 'USD' : 'INR'}
          exitReasonSuggestions={exitReasonSuggestions}
          emotionSuggestions={emotionSuggestions}
          onSave={handleCloseGroup}
          onClose={() => setClosingGroup(null)}
        />
      )}

      {viewingTrade && (
        <TradeDetailModal
          trade={viewingTrade}
          currency={isUS ? 'USD' : 'INR'}
          stockPrices={stockPrices}
          exchange={isUS ? 'US' : 'IN'}
          onClose={() => setViewingTrade(null)}
          onEdit={t => { setViewingTrade(null); handleEdit(t); }}
        />
      )}

      {isJournalPage && (
        <div className="assistant-widget">
          {assistantOpen && (
            <div className="assistant-panel">
              <div className="assistant-panel-header">
                <div className="assistant-panel-title">{isUS ? 'US Journal Assistant' : 'India Journal Assistant'}</div>
                <button className="assistant-panel-close" onClick={() => setAssistantOpen(false)} aria-label="Close assistant">×</button>
              </div>
              <AiAgentPanel
                trades={trades}
                stockPrices={stockPrices}
                currency={displayCurrency}
                locale={locale}
                market={currentPage}
                settings={settings}
              />
            </div>
          )}
          <button
            className="assistant-toggle"
            onClick={() => setAssistantOpen(prev => !prev)}
            aria-label={assistantOpen ? 'Minimize assistant chat' : 'Open assistant chat'}
          >
            {assistantOpen ? '−' : 'Chat'}
          </button>
        </div>
      )}
    </div>
  );
}
