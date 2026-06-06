import React, { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';

export default function LoginScreen({ onLogin }) {
  const btnRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function init() {
      // Wait for config to be available
      const API_URL = import.meta.env.VITE_API_URL || '/api';
      let clientId = window.__ELENA_GOOGLE_CLIENT_ID__;

      // If not loaded yet from index.html script, fetch directly
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

      // Load Google Identity Services
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
    try {
      const API_URL = import.meta.env.VITE_API_URL || '/api';
      const res = await fetch(`${API_URL}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || 'Login failed');
        return;
      }
      const data = await res.json();
      onLogin(data.token, data.user);
    } catch (err) {
      console.error('Login error:', err);
      setError('Login failed — please try again');
    }
  };

  return (
    <div className="min-h-screen bg-elena-bg flex items-center justify-center">
      <div className="text-center space-y-8">
        <div className="flex items-center justify-center">
          <div className="w-14 h-14 rounded-2xl bg-elena-accent flex items-center justify-center">
            <Sparkles size={28} className="text-white" />
          </div>
        </div>
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Elena</h1>
          <p className="text-elena-muted text-sm">Medically Modern AI Knowledge Assistant</p>
        </div>
        <div className="flex justify-center min-h-[44px]">
          <div ref={btnRef}></div>
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {loading && !error && <p className="text-elena-muted text-sm">Loading...</p>}
        <p className="text-elena-muted text-xs">Sign in with your Medically Modern Google account</p>
      </div>
    </div>
  );
}
