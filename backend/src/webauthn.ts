import { Router, Request, Response } from 'express';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const router = Router();

const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
let supabase: any = null;
if (hasSupabase) {
  supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
} else {
  console.warn('SUPABASE env vars missing — webauthn will use local JSON fallback');

  const dataDir = path.resolve(process.cwd(), 'data');
  const filePath = path.join(dataDir, 'webauthn_credentials.json');

  function readAll() {
    try {
      if (!fs.existsSync(filePath)) return [];
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      return [];
    }
  }

  function writeAll(arr: any[]) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(arr, null, 2), 'utf8');
  }

  class LocalQuery {
    table: string;
    _op: 'select' | 'delete' | 'update' | null = null;
    _cols: string | null = null;
    _filters: Array<[string, any]> = [];
    _limit: number | null = null;
    _updateObj: any = null;

    constructor(table: string) { this.table = table; }

    select(cols?: string) { this._op = 'select'; this._cols = cols || null; return this; }
    eq(field: string, val: any) { this._filters.push([field, val]); return this; }
    limit(n: number) { this._limit = n; return this; }
    delete() { this._op = 'delete'; return this; }
    insert(obj: any) {
      const arr = readAll();
      const rec = { ...obj };
      if (rec.id == null) rec.id = Math.max(0, ...arr.map((r: any) => r.id || 0)) + 1;
      arr.push(rec);
      writeAll(arr);
      return Promise.resolve({ data: [rec], error: null });
    }
    update(obj: any) {
      this._op = 'update'; this._updateObj = obj; return this;
    }

    then(resolve: any, _reject: any) {
      const arr = readAll();
      const matched = arr.filter((r: any) => this._filters.every(([f, v]) => r[f] === v));

      if (this._op === 'select') {
        const data = this._limit != null ? matched.slice(0, this._limit) : matched;
        return resolve({ data, error: null });
      }

      if (this._op === 'delete') {
        const remaining = arr.filter((r: any) => !this._filters.every(([f, v]) => r[f] === v));
        writeAll(remaining);
        return resolve({ data: [], error: null });
      }

      if (this._op === 'update') {
        let updated: any[] = [];
        const out = arr.map((r: any) => {
          if (this._filters.every(([f, v]) => r[f] === v)) {
            const u = { ...r, ...this._updateObj };
            updated.push(u);
            return u;
          }
          return r;
        });
        writeAll(out);
        return resolve({ data: updated, error: null });
      }

      return resolve({ data: [], error: null });
    }
  }

  supabase = {
    from(table: string) {
      return new LocalQuery(table);
    }
  };
}

const RP_NAME = 'Stock Journal';
const RP_ID   = process.env.WEBAUTHN_RP_ID || 'localhost';
const ORIGIN  = process.env.WEBAUTHN_ORIGIN || 'http://localhost:5173';

// Temporary in-memory challenge store (60s TTL)
const challenges = new Map<string, { challenge: string; expires: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of challenges) { if (v.expires < now) challenges.delete(k); }
}, 60_000);

// POST /api/webauthn/get-credential
router.post('/get-credential', async (req: Request, res: Response) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const { data } = await supabase
    .from('webauthn_credentials')
    .select('credential_id')
    .eq('user_id', user_id)
    .limit(1);

  res.json({ credentialId: data?.[0]?.credential_id ?? null });
});

// POST /api/webauthn/register-options
router.post('/register-options', async (req: Request, res: Response) => {
  const { user_id, user_name } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: user_id,
    userName: user_name || user_id,
    attestationType: 'none',
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'preferred',
      residentKey: 'preferred',
    },
  });

  challenges.set(user_id, { challenge: options.challenge, expires: Date.now() + 60_000 });
  res.json(options);
});

// POST /api/webauthn/register-verify
router.post('/register-verify', async (req: Request, res: Response) => {
  const { user_id, response } = req.body;
  const stored = challenges.get(user_id);
  if (!stored) return res.status(400).json({ error: 'Challenge expired, try again' });
  challenges.delete(user_id);

  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Verification failed' });
    }

    const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
    const credId = Buffer.from(credentialID).toString('base64url');

    // Delete any existing credential for this user, then insert fresh
    await supabase.from('webauthn_credentials').delete().eq('user_id', user_id);
    const { error: insertError } = await supabase.from('webauthn_credentials').insert({
      credential_id: credId,
      user_id,
      public_key: Buffer.from(credentialPublicKey).toString('base64'),
      counter,
    });

    if (insertError) {
      console.error('webauthn insert error:', insertError);
      return res.status(500).json({ error: 'Failed to save credential: ' + insertError.message });
    }

    res.json({ verified: true, credentialId: credId });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// POST /api/webauthn/auth-options
router.post('/auth-options', async (req: Request, res: Response) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: [],
    userVerification: 'preferred',
  });

  challenges.set(user_id, { challenge: options.challenge, expires: Date.now() + 60_000 });
  res.json(options);
});

// POST /api/webauthn/auth-verify
router.post('/auth-verify', async (req: Request, res: Response) => {
  const { user_id, response } = req.body;
  const stored = challenges.get(user_id);
  if (!stored) return res.status(400).json({ error: 'Challenge expired, try again' });
  challenges.delete(user_id);

  // Credential ID comes from the authenticator response itself
  const credentialId = response.id as string;

  const { data: creds } = await supabase
    .from('webauthn_credentials')
    .select('*')
    .eq('credential_id', credentialId)
    .eq('user_id', user_id)
    .limit(1);

  const cred = creds?.[0];

  if (!cred) return res.status(400).json({ error: 'Credential not found' });

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      authenticator: {
        credentialID: new Uint8Array(Buffer.from(cred.credential_id, 'base64url')),
        credentialPublicKey: new Uint8Array(Buffer.from(cred.public_key, 'base64')),
        counter: cred.counter,
      },
      requireUserVerification: false,
    });

    if (!verification.verified) return res.status(401).json({ error: 'Face ID verification failed' });

    await supabase
      .from('webauthn_credentials')
      .update({ counter: verification.authenticationInfo.newCounter })
      .eq('credential_id', credentialId);

    res.json({ verified: true });
  } catch (err) {
    res.status(401).json({ error: (err as Error).message });
  }
});

export default router;
