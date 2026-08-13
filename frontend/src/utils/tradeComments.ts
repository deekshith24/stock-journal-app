import { Trade } from '../types';

export type CommentStyle = 'danger' | 'warning' | 'success';

export interface TradeComment {
  text: string;
  style: CommentStyle;
}

export function parseDays(d: string | undefined): number {
  if (!d) return 0;
  return parseInt(d, 10) || 0;
}

export function remainingQty(t: Trade): number {
  const exited = t.exits && t.exits.length > 0
    ? t.exits.reduce((s, e) => s + e.quantity, 0)
    : (t.exit_quantity ?? 0);
  return Math.max(0, t.entry_quantity - exited);
}

export function isStalledTrade(t: Trade, currentPrice?: number): boolean {
  if (!(t.status === 'Open' || t.status === 'Partial')) return false;
  if (parseDays(t.days_in_trade) <= 10) return false;
  if (currentPrice == null) return false;
  const entry = t.entry_price || 0;
  if (entry <= 0) return false;
  const pctMove = Math.abs((currentPrice - entry) / entry) * 100;
  return currentPrice <= entry || pctMove <= 1;
}

export function getTradeComments(
  t: Trade,
  unrealizedPLPct: number | null,
  isFullPosition: boolean,
  isStalled: boolean,
  isOverdueSwing: boolean,
  isOpenOrPartial: boolean,
  marketMode: 'choppy' | 'bull' | 'neutral',
): TradeComment[] {
  if (!isOpenOrPartial) return [];
  const cs: TradeComment[] = [];

  if (isStalled)      cs.push({ text: 'Exit — stalled 10+ days', style: 'danger' });
  if (isOverdueSwing) cs.push({ text: `Exit swing (${t.days_in_trade}d held)`, style: 'danger' });
  if (t.stop_loss == null) cs.push({ text: '⚠ Set a Stop Loss', style: 'danger' });

  if (t.stop_loss != null && t.entry_price > 0) {
    const slRiskPct = ((t.entry_price - t.stop_loss) / t.entry_price) * 100;
    if (slRiskPct > 5) cs.push({ text: `SL wide (${slRiskPct.toFixed(1)}% risk/share)`, style: 'danger' });
  }

  if (t.stop_loss != null && t.entry_price > 0 && (t.pf_percentage ?? 0) > 0) {
    const slRisk = (t.entry_price - t.stop_loss) / t.entry_price;
    if (slRisk > 0) {
      const openRisk = slRisk * (t.pf_percentage! / 100) * 100;
      const limit = marketMode === 'bull' ? 2 : 1;
      if (openRisk > limit) {
        cs.push({ text: `Open risk ${openRisk.toFixed(1)}% PF (limit ${limit}%)`, style: marketMode === 'bull' ? 'warning' : 'danger' });
      }
    }
  }

  if (unrealizedPLPct != null) {
    const pfPct = t.pf_percentage ?? 0;
    const isLargePosition = pfPct >= 15;
    const isSmallPosition = pfPct > 0 && pfPct < 10;

    if (unrealizedPLPct >= 8) {
      const slProtected = t.stop_loss != null && t.stop_loss >= t.entry_price;
      if (!slProtected) cs.push({ text: 'Move SL to breakeven', style: 'warning' });
    }

    const modeThreshold = marketMode === 'choppy' ? 10 : marketMode === 'bull' ? 15 : 12;
    const bookThreshold = isLargePosition ? Math.min(modeThreshold, 10) : modeThreshold;

    if (isFullPosition && unrealizedPLPct >= bookThreshold) {
      if (!isSmallPosition || unrealizedPLPct >= 15) {
        cs.push({ text: `Book 30% (+${unrealizedPLPct.toFixed(1)}%)`, style: 'success' });
      }
    }

    if (!isFullPosition && unrealizedPLPct >= 20) {
      cs.push({ text: 'Trail SL with EMA', style: 'warning' });
    }

    if (unrealizedPLPct >= 28) {
      cs.push({ text: 'Near 30-40% target — plan exit', style: 'success' });
    }
  }

  return cs;
}

export function getGroupComments(
  bucket: Trade[],
  unrealizedPLPct: number | null,
  avgEntryPrice: number,
  isStalledGroup: boolean,
  marketMode: 'choppy' | 'bull' | 'neutral',
): TradeComment[] {
  const cs: TradeComment[] = [];

  if (isStalledGroup) cs.push({ text: 'Exit — stalled 10+ days', style: 'danger' });

  const noSLCount = bucket.filter(t => t.stop_loss == null).length;
  if (noSLCount > 0) {
    cs.push({ text: noSLCount === bucket.length ? '⚠ No Stop Loss set' : `⚠ No SL (${noSLCount} entries)`, style: 'danger' });
  }

  if (unrealizedPLPct != null) {
    if (unrealizedPLPct >= 8) {
      const slValues = bucket.map(t => t.stop_loss ?? null);
      const groupSL  = slValues.every(v => v === slValues[0]) ? slValues[0] : null;
      const slProtected = groupSL != null && groupSL >= avgEntryPrice;
      if (!slProtected) cs.push({ text: 'Move SL to breakeven', style: 'warning' });
    }

    const totalPfPct = bucket.reduce((s, t) => s + (t.pf_percentage ?? 0), 0);
    const allFull    = bucket.every(t => Math.abs(remainingQty(t) - t.entry_quantity) < 1e-8);
    const modeThreshold = marketMode === 'choppy' ? 10 : marketMode === 'bull' ? 15 : 12;
    const isLargeGroup  = totalPfPct >= 15;
    const bookThreshold = isLargeGroup ? Math.min(modeThreshold, 10) : modeThreshold;

    if (allFull && unrealizedPLPct >= bookThreshold) {
      cs.push({ text: `Book 30% (+${unrealizedPLPct.toFixed(1)}%)`, style: 'success' });
    }

    if (!allFull && unrealizedPLPct >= 20) {
      cs.push({ text: 'Trail SL with EMA', style: 'warning' });
    }

    if (unrealizedPLPct >= 28) {
      cs.push({ text: 'Near 30-40% target — plan exit', style: 'success' });
    }
  }

  return cs;
}
