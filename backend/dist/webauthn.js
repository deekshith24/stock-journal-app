"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const server_1 = require("@simplewebauthn/server");
const supabase_js_1 = require("@supabase/supabase-js");
const router = (0, express_1.Router)();
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const RP_NAME = 'Stock Journal';
const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const ORIGIN = process.env.WEBAUTHN_ORIGIN || 'http://localhost:5173';
// Temporary in-memory challenge store (60s TTL)
const challenges = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of challenges) {
        if (v.expires < now)
            challenges.delete(k);
    }
}, 60000);
// POST /api/webauthn/register-options
router.post('/register-options', async (req, res) => {
    const { user_id, user_name } = req.body;
    if (!user_id)
        return res.status(400).json({ error: 'user_id required' });
    const options = await (0, server_1.generateRegistrationOptions)({
        rpName: RP_NAME,
        rpID: RP_ID,
        userID: user_id,
        userName: user_name || user_id,
        attestationType: 'none',
        authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred',
        },
    });
    challenges.set(user_id, { challenge: options.challenge, expires: Date.now() + 60000 });
    res.json(options);
});
// POST /api/webauthn/register-verify
router.post('/register-verify', async (req, res) => {
    const { user_id, response } = req.body;
    const stored = challenges.get(user_id);
    if (!stored)
        return res.status(400).json({ error: 'Challenge expired, try again' });
    challenges.delete(user_id);
    try {
        const verification = await (0, server_1.verifyRegistrationResponse)({
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
        await supabase.from('webauthn_credentials').upsert({
            credential_id: credId,
            user_id,
            public_key: Buffer.from(credentialPublicKey).toString('base64'),
            counter,
        });
        res.json({ verified: true, credentialId: credId });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
// POST /api/webauthn/auth-options
router.post('/auth-options', async (req, res) => {
    const { user_id, credential_id } = req.body;
    if (!user_id || !credential_id)
        return res.status(400).json({ error: 'user_id and credential_id required' });
    const options = await (0, server_1.generateAuthenticationOptions)({
        rpID: RP_ID,
        allowCredentials: [{ id: Buffer.from(credential_id, 'base64url'), type: 'public-key', transports: ['internal'] }],
        userVerification: 'required',
    });
    challenges.set(user_id, { challenge: options.challenge, expires: Date.now() + 60000 });
    res.json(options);
});
// POST /api/webauthn/auth-verify
router.post('/auth-verify', async (req, res) => {
    const { user_id, credential_id, response } = req.body;
    const stored = challenges.get(user_id);
    if (!stored)
        return res.status(400).json({ error: 'Challenge expired, try again' });
    challenges.delete(user_id);
    const { data: cred } = await supabase
        .from('webauthn_credentials')
        .select('*')
        .eq('credential_id', credential_id)
        .single();
    if (!cred)
        return res.status(400).json({ error: 'Credential not found' });
    try {
        const verification = await (0, server_1.verifyAuthenticationResponse)({
            response,
            expectedChallenge: stored.challenge,
            expectedOrigin: ORIGIN,
            expectedRPID: RP_ID,
            authenticator: {
                credentialID: new Uint8Array(Buffer.from(cred.credential_id, 'base64url')),
                credentialPublicKey: new Uint8Array(Buffer.from(cred.public_key, 'base64')),
                counter: cred.counter,
            },
            requireUserVerification: true,
        });
        if (!verification.verified)
            return res.status(401).json({ error: 'Face ID verification failed' });
        await supabase
            .from('webauthn_credentials')
            .update({ counter: verification.authenticationInfo.newCounter })
            .eq('credential_id', credential_id);
        res.json({ verified: true });
    }
    catch (err) {
        res.status(401).json({ error: err.message });
    }
});
exports.default = router;
