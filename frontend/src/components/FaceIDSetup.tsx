import { useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';

const API = import.meta.env.VITE_API_URL ?? '';

interface Props {
  userId: string;
  userName: string;
  onDone: () => void;
  onSkip: () => void;
}

export default function FaceIDSetup({ userId, userName, onDone, onSkip }: Props) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSetup = async () => {
    setStatus('loading');
    try {
      const optsRes = await fetch(`${API}/api/webauthn/register-options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, user_name: userName }),
      });
      const opts = await optsRes.json();

      const regResponse = await startRegistration(opts);

      const verifyRes = await fetch(`${API}/api/webauthn/register-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, response: regResponse }),
      });
      const result = await verifyRes.json();

      if (!result.verified) throw new Error(result.error || 'Setup failed');

      localStorage.setItem('webauthn_credential_id', result.credentialId);
      onDone();
    } catch (err) {
      setStatus('error');
      setErrorMsg((err as Error).message);
    }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: '#f8fafc',
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '48px 40px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)', textAlign: 'center', maxWidth: 360, width: '100%',
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>Enable Face ID</h2>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 32, lineHeight: 1.6 }}>
          Lock your trading data with Face ID so only you can access it.
        </p>

        {status === 'error' && (
          <div style={{ background: '#fee2e2', color: '#991b1b', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>
            {errorMsg}
          </div>
        )}

        <button
          onClick={handleSetup}
          disabled={status === 'loading'}
          style={{
            width: '100%', padding: '12px', borderRadius: 8, border: 'none',
            background: '#1e293b', color: '#fff', fontSize: 15, fontWeight: 600,
            cursor: status === 'loading' ? 'not-allowed' : 'pointer', marginBottom: 12,
          }}
        >
          {status === 'loading' ? 'Setting up…' : 'Enable Face ID'}
        </button>

        <button
          onClick={onSkip}
          style={{
            width: '100%', padding: '12px', borderRadius: 8, border: '1px solid #e2e8f0',
            background: '#fff', color: '#64748b', fontSize: 14, cursor: 'pointer',
          }}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
