import React, { useState } from 'react';

interface Props {
  onSuccess?: () => void; // called after successful login/register
  onCancel?: () => void;
  showGoogle?: boolean;   // show existing Google sign-in button (optional)
  onGoogleSignIn?: () => void;
  noWrapper?: boolean; // render form without outer card wrapper when true
}

/**
 * Minimal register / login form.
 * - POST /api/auth/register  { email, password }
 * - POST /api/auth/login     { email, password }
 *
 * On success we expect backend to set auth cookie (httpOnly) and return 200/201.
 * After success we call onSuccess() or reload the page if onSuccess not provided.
 */
export default function LoginRegisterForm({ onSuccess, onCancel, showGoogle = true, onGoogleSignIn, noWrapper = false }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const reset = () => {
    setEmail('');
    setPassword('');
    setConfirm('');
    setError(null);
  };

  const validate = () => {
    if (!email || !password) {
      setError('Please enter email and password.');
      return false;
    }
    // simple email validation
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError('Please enter a valid email address.');
      return false;
    }
    if (mode === 'register' && password.length < 6) {
      setError('Password must be at least 6 characters.');
      return false;
    }
    if (mode === 'register' && password !== confirm) {
      setError('Passwords do not match.');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (!validate()) return;

    setLoading(true);
    try {
      const url = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // ensure cookies are included in cross-origin dev/proxy setups
        credentials: 'include',
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const text = await res.text().catch(() => null);
      // prefer JSON response, but support text
      let json;
      try { json = text ? JSON.parse(text) : null; } catch (err) { json = null; }

      if (!res.ok) {
        const msg = json?.message || json?.error || text || `Request failed (${res.status})`;
        setError(msg);
        setLoading(false);
        return;
      }

      // success
      if (mode === 'register') {
        // show success message and switch to login mode
        setSuccess(json?.message || 'Account created successfully. Please sign in.');
        setMode('login');
        // clear passwords
        setPassword('');
        setConfirm('');
        setLoading(false);
        return;
      }

      // login success — backend should have set cookie/session
      if (onSuccess) onSuccess();
      else window.location.reload();
    } catch (err: any) {
      console.error('Auth error', err);
      setError(err?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const formContent = (
    <>
      <div className="text-start mb-4 mt-8">
        <h2 className="text-lg font-semibold">{mode === 'login' ? 'Sign in' : 'Create account'}</h2>
        <p className="text-sm text-gray-500">{mode === 'login' ? 'Use your email and password' : 'Register and start building'}</p>
      </div>

      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}
      {success && <div className="mb-3 text-sm text-green-600">{success}</div>}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-xs text-gray-600">Email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            className="mt-1 block w-full border rounded px-3 py-2"
            placeholder="you@example.com"
            required
          />
        </div>

        <div>
          <label className="text-xs text-gray-600">Password</label>
          <div className="relative">
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={showPassword ? 'text' : 'password'}
              className="mt-1 block w-full border rounded px-3 py-2 pr-10"
              placeholder="••••••••"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        {mode === 'register' && (
          <div>
            <label className="text-xs text-gray-600">Confirm password</label>
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              type="password"
              className="mt-1 block w-full border rounded px-3 py-2"
              placeholder="Re-enter password"
              required
            />
          </div>
        )}

        <div className="flex items-center justify-between">
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? (mode === 'login' ? 'Signing in...' : 'Creating...') : (mode === 'login' ? 'Sign in' : 'Create account')}
          </button>

          <div className="text-sm">
            <button
              type="button"
              onClick={() => { setMode(m => m === 'login' ? 'register' : 'login'); reset(); }}
              className="text-blue-600 hover:underline"
            >
              {mode === 'login' ? 'Create an account' : 'Have an account? Sign in'}
            </button>
          </div>
        </div>

        <div className="pt-2">
          {showGoogle && onGoogleSignIn && (
            <button
              type="button"
              onClick={onGoogleSignIn}
              className="w-full border rounded px-3 py-2 text-sm hover:bg-gray-50"
            >
              Sign in with Google
            </button>
          )}
        </div>

        <div className="pt-2 text-center">
          <button type="button" onClick={onCancel} className="text-xs text-gray-500 hover:underline">Cancel</button>
        </div>
      </form>
    </>
  );

  if (noWrapper) return <>{formContent}</>;

  return (
    <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-6">
      {formContent}
    </div>
  );
}
