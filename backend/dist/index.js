"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const supabase_js_1 = require("@supabase/supabase-js");
const routes_1 = __importDefault(require("./routes"));
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3002;
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// JWT auth middleware — validates Supabase session token
app.use('/api', async (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token)
        return res.status(401).json({ error: 'Unauthorized' });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user)
        return res.status(401).json({ error: 'Unauthorized' });
    next();
});
app.use('/api', routes_1.default);
app.listen(PORT, () => {
    console.log(`Stock Journal API running on http://localhost:${PORT}`);
});
