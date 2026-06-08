import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import router from './routes';
import webauthnRouter from './webauthn';
const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);

const app = express();
const PORT = process.env.PORT || 3002;

let supabase: any = null;
if (hasSupabase) {
  supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
} else {
  console.warn('SUPABASE env vars missing — JWT auth middleware disabled for local dev');
}

app.use(cors());
app.use(express.json());

// WebAuthn routes — no auth required (pre-authentication)
app.use('/api/webauthn', webauthnRouter);

// JWT auth middleware — validates Supabase session token
if (hasSupabase && supabase) {
  app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ error: 'Unauthorized' });
    next();
  });
} else {
  // No Supabase configured — allow all /api requests for local development
  app.use('/api', (_req: Request, _res: Response, next: NextFunction) => next());
}

app.use('/api', router);

app.listen(PORT, () => {
  console.log(`Stock Journal API running on http://localhost:${PORT}`);
});
