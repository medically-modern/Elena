import React, { useEffect, useRef, useState } from 'react';

export default function LoginScreen({ onLogin }) {
  const btnRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function init() {
      const API_URL = import.meta.env.VITE_API_URL || '/api';
      let clientId = window.__ELENA_GOOGLE_CLIENT_ID__;

      if (!clientId) {
        try {
          const res = await fetch(`${API_URL}/config`);
          const config = await res.json();
          clientId = config.googleClientId;
          window.__ELENA_GOOGLE_CLIENT_ID__ = clientId;
        } catch {}
      }

      if (!clientId) {
        if (mounted) { setError('Google Sign-In not configured yet'); setLoading(false); }
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => {
        if (!mounted) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: handleCredentialResponse,
        });
        window.google.accounts.id.renderButton(btnRef.current, {
          theme: 'filled_black',
          size: 'large',
          width: 300,
          text: 'signin_with',
          shape: 'rectangular',
        });
        setLoading(false);
      };
      script.onerror = () => {
        if (mounted) { setError('Failed to load Google Sign-In'); setLoading(false); }
      };
      document.body.appendChild(script);
    }

    init();
    return () => { mounted = false; };
  }, []);

  const handleCredentialResponse = async (response) => {
    setError(null);
    try {
      const API_URL = import.meta.env.VITE_API_URL || '/api';
      const res = await fetch(`${API_URL}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }
      onLogin(data.token, data.user);
    } catch (err) {
      console.error('Login error:', err);
      setError('Network error — please try again');
    }
  };

  return (
    <div className="min-h-screen bg-elena-bg flex items-center justify-center">
      <div className="text-center space-y-8">
        <div className="flex items-center justify-center">
          <img src="/elena-logo.svg" alt="Elena" width={56} height={56} className="rounded-2xl" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Elena</h1>
          <p className="text-elena-muted text-sm">Medically Modern AI Knowledge Assistant</p>
        </div>
        <div className="flex justify-center min-h-[44px]">
          <div ref={btnRef}></div>
        </div>
        {error && <p className="text-red-400 text-sm max-w-sm">{error}</p>}
        {loading && !error && <p className="text-elena-muted text-sm">Loading...</p>}
        <p className="text-elena-muted text-xs">Sign in with your Medically Modern Google account</p>
      </div>
    </div>
  );
}
