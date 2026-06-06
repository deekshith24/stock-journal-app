import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import router from './routes';
import webauthnRouter from './webauthn';

const app = express();
const PORT = process.env.PORT || 3002;

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

app.use(cors());
app.use(express.json());

// WebAuthn routes — no auth required (pre-authentication)
app.use('/api/webauthn', webauthnRouter);

// JWT auth middleware — validates Supabase session token
app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

app.use('/api', router);

const hfTokenPresent = Boolean(process.env.HF_API_TOKEN);
const hfModel = process.env.HF_MODEL || 'google/flan-t5-small';
console.log(`Hugging Face model: ${hfModel}`);
console.log(`HF_API_TOKEN present: ${hfTokenPresent ? 'yes' : 'no'}`);

app.listen(PORT, () => {
  console.log(`Stock Journal API running on http://localhost:${PORT}`);
});
