"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllTrades = getAllTrades;
exports.getTradeById = getTradeById;
exports.createTrade = createTrade;
exports.updateTrade = updateTrade;
exports.deleteTrade = deleteTrade;
exports.getAllUsTrades = getAllUsTrades;
exports.getUsTradeById = getUsTradeById;
exports.createUsTrade = createUsTrade;
exports.updateUsTrade = updateUsTrade;
exports.deleteUsTrade = deleteUsTrade;
exports.getSettings = getSettings;
exports.saveSettings = saveSettings;
exports.logActivity = logActivity;
exports.getActivityLog = getActivityLog;
const supabase_js_1 = require("@supabase/supabase-js");
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
// ── India trades ──────────────────────────────────────────────────────────────
async function getAllTrades() {
    const { data, error } = await supabase
        .from('trades')
        .select('*')
        .order('entry_date', { ascending: false })
        .order('id', { ascending: false });
    if (error)
        throw new Error(error.message);
    return (data ?? []);
}
async function getTradeById(id) {
    const { data } = await supabase.from('trades').select('*').eq('id', id).single();
    return data;
}
async function createTrade(data) {
    const { data: trade, error } = await supabase.from('trades').insert(data).select().single();
    if (error)
        throw new Error(error.message);
    return trade;
}
async function updateTrade(id, data) {
    const { data: trade, error } = await supabase
        .from('trades').update(data).eq('id', id).select().single();
    if (error)
        return null;
    return trade;
}
async function deleteTrade(id) {
    const { error } = await supabase.from('trades').delete().eq('id', id);
    return !error;
}
// ── US trades ─────────────────────────────────────────────────────────────────
async function getAllUsTrades() {
    const { data, error } = await supabase
        .from('us_trades')
        .select('*')
        .order('entry_date', { ascending: false })
        .order('id', { ascending: false });
    if (error)
        throw new Error(error.message);
    return (data ?? []);
}
async function getUsTradeById(id) {
    const { data } = await supabase.from('us_trades').select('*').eq('id', id).single();
    return data;
}
async function createUsTrade(data) {
    const { data: trade, error } = await supabase.from('us_trades').insert(data).select().single();
    if (error)
        throw new Error(error.message);
    return trade;
}
async function updateUsTrade(id, data) {
    const { data: trade, error } = await supabase
        .from('us_trades').update(data).eq('id', id).select().single();
    if (error)
        return null;
    return trade;
}
async function deleteUsTrade(id) {
    const { error } = await supabase.from('us_trades').delete().eq('id', id);
    return !error;
}
// ── Settings ──────────────────────────────────────────────────────────────────
async function getSettings() {
    const { data } = await supabase.from('settings').select('*').eq('id', 1).single();
    if (!data)
        return { portfolio_size: 300000, us_portfolio_size: 50000, usd_to_inr: 84 };
    return {
        portfolio_size: data.portfolio_size ?? 300000,
        us_portfolio_size: data.us_portfolio_size ?? 50000,
        usd_to_inr: data.usd_to_inr ?? 84,
    };
}
async function saveSettings(s) {
    await supabase.from('settings').upsert({ id: 1, ...s });
}
// ── Activity log ──────────────────────────────────────────────────────────────
async function logActivity(entry) {
    await supabase.from('activity').insert(entry);
}
async function getActivityLog() {
    const { data } = await supabase
        .from('activity')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(2000);
    return (data ?? []);
}
