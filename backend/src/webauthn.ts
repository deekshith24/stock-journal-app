import { Router, Request, Response } from 'express';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { createClient } from '@supabase/supabase-js';

const router = Router();
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

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
  const { user_id, credential_id } = req.body;
  if (!user_id || !credential_id) return res.status(400).json({ error: 'user_id and credential_id required' });

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: [{ id: Buffer.from(credential_id, 'base64url'), type: 'public-key' }],
    userVerification: 'preferred',
  });

  challenges.set(user_id, { challenge: options.challenge, expires: Date.now() + 60_000 });
  res.json(options);
});

// POST /api/webauthn/auth-verify
router.post('/auth-verify', async (req: Request, res: Response) => {
  const { user_id, credential_id, response } = req.body;
  const stored = challenges.get(user_id);
  if (!stored) return res.status(400).json({ error: 'Challenge expired, try again' });
  challenges.delete(user_id);

  const { data: creds } = await supabase
    .from('webauthn_credentials')
    .select('*')
    .eq('credential_id', credential_id)
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
      .eq('credential_id', credential_id);

    res.json({ verified: true });
  } catch (err) {
    res.status(401).json({ error: (err as Error).message });
  }
});

export default router;
