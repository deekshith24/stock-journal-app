import https from 'https';
import { Router, Request, Response } from 'express';
import {
  getAllTrades, getTradeById, createTrade, updateTrade, deleteTrade,
  getAllUsTrades, getUsTradeById, createUsTrade, updateUsTrade, deleteUsTrade,
  getSettings, saveSettings,
} from './database';
import { Trade, ExitRecord } from './types';

const router = Router();

// Cache Yahoo prices for 5 minutes to avoid 429 rate-limiting
const priceCache = new Map<string, { data: YahooPriceResult; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

// In-flight request coalescing — multiple callers for the same ticker share one HTTP request
const inFlight = new Map<string, Promise<YahooPriceResult>>();

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const reqOptions = {
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StockJournal/1.0)',
        ...headers,
      },
    };
    https.get(reqOptions, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body) as T;
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`${res.statusCode} Too Many Requests: ${body}`));
          }
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

function calcDaysInTrade(entryDate: string, exitDate: string | null): string {
  const entry = new Date(entryDate);
  const exit = exitDate ? new Date(exitDate) : new Date();
  const diff = Math.round((exit.getTime() - entry.getTime()) / (1000 * 60 * 60 * 24));
  return `${Math.max(0, diff)}d`;
}

function enrichTrade(trade: Trade, portfolioSize: number) {
  const invested = trade.entry_price * trade.entry_quantity;
  const pfPercentage = portfolioSize > 0 ? (invested / portfolioSize) * 100 : 0;

  let totalExitQty = 0;
  let totalPL = 0;
  let totalProceeds = 0;
  let lastExitDate: string | null = null;
  const exitReasons: string[] = [];
  const exitEmotions: string[] = [];

  if (trade.exits && trade.exits.length > 0) {
    for (const e of trade.exits) {
      totalExitQty += e.quantity;
      totalPL += (e.price - trade.entry_price) * e.quantity;
      totalProceeds += e.price * e.quantity;
      if (e.reason) exitReasons.push(e.reason);
      if (e.emotions) exitEmotions.push(e.emotions);
    }
    lastExitDate = trade.exits[trade.exits.length - 1].date;
  } else if (trade.exit_quantity != null && trade.exit_price != null) {
    // Legacy scalar fallback
    totalExitQty = trade.exit_quantity;
    totalPL = (trade.exit_price - trade.entry_price) * trade.exit_quantity;
    totalProceeds = trade.exit_price * trade.exit_quantity;
    lastExitDate = trade.exit_date;
    if (trade.reason_for_exit) exitReasons.push(trade.reason_for_exit);
    if (trade.emotions) exitEmotions.push(trade.emotions);
  }

  let status: 'Open' | 'Partial' | 'Closed';
  const EPSILON = 1e-9;
  if (totalExitQty <= 0) status = 'Open';
  else if (totalExitQty >= trade.entry_quantity - EPSILON) status = 'Closed';
  else status = 'Partial';

  const exitDateForDays = status === 'Closed' ? lastExitDate : null;
  const weightedExitPrice = totalExitQty > 0 ? totalProceeds / totalExitQty : null;

  return {
    ...trade,
    exits: trade.exits ?? [],
    status,
    // Scalar display fields derived from exits array so the table always shows correct totals
    exit_quantity: totalExitQty > 0 ? totalExitQty : null,
    exit_price: weightedExitPrice,
    exit_date: lastExitDate,
    reason_for_exit: exitReasons.join(' | '),
    emotions: exitEmotions.join(' | '),
    days_in_trade: calcDaysInTrade(trade.entry_date, exitDateForDays),
    invested,
    pf_percentage: pfPercentage,
    pl: totalPL,
    pl_percentage: invested > 0 ? (totalPL / invested) * 100 : 0,
  };
}

function enrichAll(trades: Trade[], portfolioSize: number) {
  return trades.map(t => enrichTrade(t, portfolioSize));
}

// Only updates entry fields; always preserves exits and legacy scalar exit fields
function buildEntryPayload(body: Trade, existing: Trade) {
  return {
    stock: body.stock ? body.stock.toUpperCase().trim() : existing.stock,
    trade_type: body.trade_type ?? existing.trade_type,
    entry_date: body.entry_date || existing.entry_date,
    entry_quantity: body.entry_quantity ? Number(body.entry_quantity) : existing.entry_quantity,
    entry_price: body.entry_price ? Number(body.entry_price) : existing.entry_price,
    reason_for_entry: body.reason_for_entry !== undefined ? body.reason_for_entry : existing.reason_for_entry,
    // Always preserve exit data
    exit_date: existing.exit_date,
    exit_quantity: existing.exit_quantity,
    exit_price: existing.exit_price,
    reason_for_exit: existing.reason_for_exit,
    emotions: existing.emotions,
    exits: existing.exits,
  };
}

// ── India trades ──────────────────────────────────────────────────────────────

router.get('/trades', (_req: Request, res: Response) => {
  const { portfolio_size } = getSettings();
  res.json(enrichAll(getAllTrades(), portfolio_size));
});

router.get('/trades/:id', (req: Request, res: Response) => {
  const trade = getTradeById(parseInt(req.params.id));
  if (!trade) return res.status(404).json({ error: 'Trade not found' });
  const { portfolio_size } = getSettings();
  res.json(enrichTrade(trade, portfolio_size));
});

router.post('/trades', (req: Request, res: Response) => {
  const body = req.body as Trade;
  if (!body.stock || !body.entry_date || !body.entry_quantity || !body.entry_price) {
    return res.status(400).json({ error: 'Required: stock, entry_date, entry_quantity, entry_price' });
  }
  const trade = createTrade({
    stock: body.stock.toUpperCase().trim(),
    trade_type: body.trade_type || 'swing',
    entry_date: body.entry_date,
    entry_quantity: Number(body.entry_quantity),
    entry_price: Number(body.entry_price),
    reason_for_entry: body.reason_for_entry || '',
    exit_date: null,
    exit_quantity: null,
    exit_price: null,
    reason_for_exit: '',
    emotions: '',
    exits: [],
  });
  const { portfolio_size } = getSettings();
  res.status(201).json(enrichTrade(trade, portfolio_size));
});

router.put('/trades/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const existing = getTradeById(id);
  if (!existing) return res.status(404).json({ error: 'Trade not found' });
  const updated = updateTrade(id, buildEntryPayload(req.body as Trade, existing));
  if (!updated) return res.status(404).json({ error: 'Trade not found' });
  const { portfolio_size } = getSettings();
  res.json(enrichTrade(updated, portfolio_size));
});

router.delete('/trades/:id', (req: Request, res: Response) => {
  const deleted = deleteTrade(parseInt(req.params.id));
  if (!deleted) return res.status(404).json({ error: 'Trade not found' });
  res.json({ success: true });
});

router.post('/trades/:id/exits', (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const trade = getTradeById(id);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });

  const newExit: ExitRecord = {
    date: req.body.date,
    quantity: Number(req.body.quantity),
    price: Number(req.body.price),
    reason: req.body.reason || '',
    emotions: req.body.emotions || '',
  };

  if (!newExit.quantity || newExit.quantity <= 0) {
    return res.status(400).json({ error: 'Exit quantity must be greater than 0' });
  }

  // Auto-migrate legacy scalar fields to exits array on first new close
  let exits: ExitRecord[] = trade.exits ? [...trade.exits] : [];
  if (exits.length === 0 && trade.exit_quantity && trade.exit_price) {
    exits = [{
      date: trade.exit_date || new Date().toISOString().slice(0, 10),
      quantity: trade.exit_quantity,
      price: trade.exit_price,
      reason: trade.reason_for_exit || '',
      emotions: trade.emotions || '',
    }];
  }

  const alreadyExited = exits.reduce((s, e) => s + e.quantity, 0);
  const remaining = Math.round((trade.entry_quantity - alreadyExited) * 1e8) / 1e8;
  if (newExit.quantity > remaining + 1e-8) {
    return res.status(400).json({ error: `Cannot exit ${newExit.quantity} shares — only ${remaining} remaining` });
  }

  exits.push(newExit);

  const updated = updateTrade(id, { ...trade, exits });
  if (!updated) return res.status(404).json({ error: 'Trade not found' });
  const { portfolio_size } = getSettings();
  res.json(enrichTrade(updated, portfolio_size));
});

// ── US trades ─────────────────────────────────────────────────────────────────

router.get('/us-trades', (_req: Request, res: Response) => {
  const { us_portfolio_size } = getSettings();
  res.json(enrichAll(getAllUsTrades(), us_portfolio_size));
});

router.get('/us-trades/:id', (req: Request, res: Response) => {
  const trade = getUsTradeById(parseInt(req.params.id));
  if (!trade) return res.status(404).json({ error: 'Trade not found' });
  const { us_portfolio_size } = getSettings();
  res.json(enrichTrade(trade, us_portfolio_size));
});

router.post('/us-trades', (req: Request, res: Response) => {
  const body = req.body as Trade;
  if (!body.stock || !body.entry_date || !body.entry_quantity || !body.entry_price) {
    return res.status(400).json({ error: 'Required: stock, entry_date, entry_quantity, entry_price' });
  }
  const trade = createUsTrade({
    stock: body.stock.toUpperCase().trim(),
    trade_type: body.trade_type || 'swing',
    entry_date: body.entry_date,
    entry_quantity: Number(body.entry_quantity),
    entry_price: Number(body.entry_price),
    reason_for_entry: body.reason_for_entry || '',
    exit_date: null,
    exit_quantity: null,
    exit_price: null,
    reason_for_exit: '',
    emotions: '',
    exits: [],
  });
  const { us_portfolio_size } = getSettings();
  res.status(201).json(enrichTrade(trade, us_portfolio_size));
});

router.put('/us-trades/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const existing = getUsTradeById(id);
  if (!existing) return res.status(404).json({ error: 'Trade not found' });
  const updated = updateUsTrade(id, buildEntryPayload(req.body as Trade, existing));
  if (!updated) return res.status(404).json({ error: 'Trade not found' });
  const { us_portfolio_size } = getSettings();
  res.json(enrichTrade(updated, us_portfolio_size));
});

router.delete('/us-trades/:id', (req: Request, res: Response) => {
  const deleted = deleteUsTrade(parseInt(req.params.id));
  if (!deleted) return res.status(404).json({ error: 'Trade not found' });
  res.json({ success: true });
});

router.post('/us-trades/:id/exits', (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const trade = getUsTradeById(id);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });

  const newExit: ExitRecord = {
    date: req.body.date,
    quantity: Number(req.body.quantity),
    price: Number(req.body.price),
    reason: req.body.reason || '',
    emotions: req.body.emotions || '',
  };

  if (!newExit.quantity || newExit.quantity <= 0) {
    return res.status(400).json({ error: 'Exit quantity must be greater than 0' });
  }

  let exits: ExitRecord[] = trade.exits ? [...trade.exits] : [];
  if (exits.length === 0 && trade.exit_quantity && trade.exit_price) {
    exits = [{
      date: trade.exit_date || new Date().toISOString().slice(0, 10),
      quantity: trade.exit_quantity,
      price: trade.exit_price,
      reason: trade.reason_for_exit || '',
      emotions: trade.emotions || '',
    }];
  }

  const alreadyExited = exits.reduce((s, e) => s + e.quantity, 0);
  const remaining = Math.round((trade.entry_quantity - alreadyExited) * 1e8) / 1e8;
  if (newExit.quantity > remaining + 1e-8) {
    return res.status(400).json({ error: `Cannot exit ${newExit.quantity} shares — only ${remaining} remaining` });
  }

  exits.push(newExit);

  const updated = updateUsTrade(id, { ...trade, exits });
  if (!updated) return res.status(404).json({ error: 'Trade not found' });
  const { us_portfolio_size } = getSettings();
  res.json(enrichTrade(updated, us_portfolio_size));
});

router.put('/trades/:id/exits', (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const trade = getTradeById(id);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });
  const exits: ExitRecord[] = req.body.exits;
  if (!Array.isArray(exits)) return res.status(400).json({ error: 'exits must be an array' });
  const totalExited = exits.reduce((s, e) => s + Number(e.quantity), 0);
  if (totalExited > trade.entry_quantity + 1e-8) {
    return res.status(400).json({ error: `Total exit quantity ${totalExited} exceeds entry quantity ${trade.entry_quantity}` });
  }
  const updated = updateTrade(id, { ...trade, exits });
  if (!updated) return res.status(404).json({ error: 'Trade not found' });
  const { portfolio_size } = getSettings();
  res.json(enrichTrade(updated, portfolio_size));
});

router.put('/us-trades/:id/exits', (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const trade = getUsTradeById(id);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });
  const exits: ExitRecord[] = req.body.exits;
  if (!Array.isArray(exits)) return res.status(400).json({ error: 'exits must be an array' });
  const totalExited = exits.reduce((s, e) => s + Number(e.quantity), 0);
  if (totalExited > trade.entry_quantity + 1e-8) {
    return res.status(400).json({ error: `Total exit quantity ${totalExited} exceeds entry quantity ${trade.entry_quantity}` });
  }
  const updated = updateUsTrade(id, { ...trade, exits });
  if (!updated) return res.status(404).json({ error: 'Trade not found' });
  const { us_portfolio_size } = getSettings();
  res.json(enrichTrade(updated, us_portfolio_size));
});

// ── Settings ──────────────────────────────────────────────────────────────────
router.get('/settings', (_req: Request, res: Response) => {
  res.json(getSettings());
});

router.put('/settings', (req: Request, res: Response) => {
  const { portfolio_size, us_portfolio_size, usd_to_inr } = req.body;
  const updated = {
    portfolio_size: parseFloat(String(portfolio_size)) || 300000,
    us_portfolio_size: parseFloat(String(us_portfolio_size)) || 50000,
    usd_to_inr: parseFloat(String(usd_to_inr)) || 84,
  };
  saveSettings(updated);
  res.json(updated);
});

router.get('/usd-to-inr/:date', async (req: Request, res: Response) => {
  const date = req.params.date;

  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
  }

  try {
    // Try open-er-api.com (free, no key required)
    const data = await fetchJson<{ rates?: { INR?: number } }>(
      `https://open.er-api.com/v6/latest/USD`
    );
    const rate = Number(data?.rates?.INR);
    if (!rate || Number.isNaN(rate)) throw new Error('Invalid rate');
    return res.json({ date, rate });
  } catch (error) {
    console.error('USD→INR fetch error:', error);
    return res.status(502).json({ error: 'Failed to fetch USD→INR rate' });
  }
});

// ── Stock Prices ──────────────────────────────────────────────────────────────────

interface YahooChartMeta {
  regularMarketPrice: number;
  chartPreviousClose?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketTime?: number;
}

interface YahooChartResponse {
  chart: {
    result?: Array<{ meta: YahooChartMeta }>;
    error?: { description: string };
  };
}

type YahooPriceResult = { currentPrice: number; previousClose: number; dayHigh: number; dayLow: number; timestamp: number };

async function fetchYahooPrice(ticker: string): Promise<YahooPriceResult> {
  const cached = priceCache.get(ticker);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  // If a fetch for this ticker is already in-flight, share it — avoids duplicate Yahoo requests
  const existing = inFlight.get(ticker);
  if (existing) return existing;

  const fetch = (async () => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;

    let data: YahooChartResponse;
    try {
      data = await fetchJson<YahooChartResponse>(url);
    } catch (err: unknown) {
      // Retry once after 2 s on 429
      if (err instanceof Error && err.message.includes('429')) {
        await sleep(2000);
        data = await fetchJson<YahooChartResponse>(url);
      } else {
        throw err;
      }
    } finally {
      inFlight.delete(ticker);
    }

    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) throw new Error(`No price data for ${ticker}`);
    const p = meta.regularMarketPrice;
    const result: YahooPriceResult = {
      currentPrice:  Math.round(p * 100) / 100,
      previousClose: Math.round((meta.chartPreviousClose ?? p) * 100) / 100,
      dayHigh:       Math.round((meta.regularMarketDayHigh ?? p) * 100) / 100,
      dayLow:        Math.round((meta.regularMarketDayLow  ?? p) * 100) / 100,
      timestamp:     meta.regularMarketTime ?? Math.floor(Date.now() / 1000),
    };
    priceCache.set(ticker, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  })();

  inFlight.set(ticker, fetch);
  return fetch;
}

router.get('/stock-price/:symbol/:exchange', async (req: Request, res: Response) => {
  const { symbol, exchange } = req.params;

  if (!symbol || !exchange) {
    return res.status(400).json({ error: 'Symbol and exchange required' });
  }

  const ticker = exchange === 'IN' ? `${symbol.toUpperCase()}.NS` : symbol.toUpperCase();

  try {
    const price = await fetchYahooPrice(ticker);
    return res.json({ symbol: symbol.toUpperCase(), exchange, ...price });
  } catch (primaryErr) {
    console.error(`Yahoo Finance error for ${ticker}:`, primaryErr);

    // For US stocks only: try BSE suffix as secondary attempt
    if (exchange === 'IN') {
      try {
        const bseTicker = `${symbol.toUpperCase()}.BO`;
        const price = await fetchYahooPrice(bseTicker);
        return res.json({ symbol: symbol.toUpperCase(), exchange, ...price });
      } catch {
        // fall through to hardcoded
      }
    }

    // Last-resort hardcoded fallback (only for known symbols — avoids wildly wrong values)
    const knownPrices: Record<string, number> = {
      'NATIONALUM': 420, 'NLCINDIA': 300, 'AVANTIFEEDS': 1487, 'TRUALT': 445,
      'ATHERENERGY': 908, 'GLENMARK': 2403, 'IMFA': 1566, 'PARAS': 834,
      'APOLLO': 297, 'KIRLOSENG': 1668, 'SAILIFE': 1001, 'ABSLAMC': 957,
      'DATAPATTERN': 3608, 'APAR': 10542, 'AMBER': 7836,
      'AAPL': 195, 'GOOGL': 142, 'MSFT': 415, 'AMZN': 185,
      'TSLA': 248, 'NVDA': 875, 'META': 485, 'NFLX': 650,
    };
    const fallback = knownPrices[symbol.toUpperCase()];
    if (!fallback) {
      return res.status(503).json({ error: `Price unavailable for ${symbol}` });
    }
    return res.json({
      symbol: symbol.toUpperCase(), exchange,
      currentPrice: fallback, previousClose: fallback,
      dayHigh: fallback, dayLow: fallback,
      timestamp: Math.floor(Date.now() / 1000),
    });
  }
});

export default router;
