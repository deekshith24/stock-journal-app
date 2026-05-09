import { useState, useEffect } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { supabase } from '../supabaseClient';

const API = import.meta.env.VITE_API_URL ?? '';

interface Props {
  userId: string;
  credentialId: string;
  onSuccess: () => void;
  onCredentialNotFound?: () => void;
}

export default function FaceIDPrompt({ userId, credentialId, onSuccess, onCredentialNotFound }: Props) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleAuth = async () => {
    setStatus('loading');
    setErrorMsg('');
    try {
      const optsRes = await fetch(`${API}/api/webauthn/auth-options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, credential_id: credentialId }),
      });
      const opts = await optsRes.json();

      const authResponse = await startAuthentication(opts);

      const verifyRes = await fetch(`${API}/api/webauthn/auth-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, credential_id: credentialId, response: authResponse }),
      });
      const result = await verifyRes.json();

      if (!result.verified) throw new Error(result.error || 'Authentication failed');
      onSuccess();
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('Credential not found') && onCredentialNotFound) {
        onCredentialNotFound();
        return;
      }
      setStatus('error');
      setErrorMsg(msg);
    }
  };

  // Auto-trigger Face ID on mount
  useEffect(() => { handleAuth(); }, []);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: '#f8fafc',
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '48px 40px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)', textAlign: 'center', maxWidth: 360, width: '100%',
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>{status === 'loading' ? '⏳' : status === 'error' ? '❌' : '🔒'}</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>
          {status === 'loading' ? 'Verifying…' : status === 'error' ? 'Try Again' : 'Face ID Required'}
        </h2>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 32, lineHeight: 1.6 }}>
          {status === 'error' ? errorMsg : 'Authenticate with Face ID to open Stock Journal'}
        </p>

        <button
          onClick={handleAuth}
          disabled={status === 'loading'}
          style={{
            width: '100%', padding: '12px', borderRadius: 8, border: 'none',
            background: '#1e293b', color: '#fff', fontSize: 15, fontWeight: 600,
            cursor: status === 'loading' ? 'not-allowed' : 'pointer', marginBottom: 12,
          }}
        >
          {status === 'loading' ? 'Waiting for Face ID…' : 'Use Face ID'}
        </button>

        <button
          onClick={() => supabase.auth.signOut()}
          style={{
            width: '100%', padding: '10px', borderRadius: 8, border: '1px solid #e2e8f0',
            background: '#fff', color: '#94a3b8', fontSize: 13, cursor: 'pointer',
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
