import { FormEvent, useState, useEffect } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

function SuperNovaLogo({ size = 52 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="SuperNova AI logo"
    >
      <circle cx="32" cy="32" r="30" fill="url(#snGlow)" opacity="0.18" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
        const rad = (deg * Math.PI) / 180;
        const inner = i % 2 === 0 ? 14 : 11;
        const outer = i % 2 === 0 ? 31 : 26;
        const x1 = 32 + Math.cos(rad) * inner;
        const y1 = 32 + Math.sin(rad) * inner;
        const x2 = 32 + Math.cos(rad) * outer;
        const y2 = 32 + Math.sin(rad) * outer;
        return (
          <line
            key={deg}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={i % 2 === 0 ? '#4F46E5' : '#818CF8'}
            strokeWidth={i % 2 === 0 ? 3 : 2}
            strokeLinecap="round"
          />
        );
      })}
      <circle cx="32" cy="32" r="10" fill="url(#snCore)" />
      <circle cx="32" cy="32" r="4.5" fill="#ffffff" opacity="0.95" />
      <line x1="32" y1="18" x2="32" y2="22" stroke="#A5B4FC" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="32" y1="42" x2="32" y2="46" stroke="#A5B4FC" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="18" y1="32" x2="22" y2="32" stroke="#A5B4FC" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="42" y1="32" x2="46" y2="32" stroke="#A5B4FC" strokeWidth="1.5" strokeLinecap="round" />
      <defs>
        <radialGradient id="snGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#4F46E5" />
          <stop offset="100%" stopColor="#4F46E5" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="snCore" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#818CF8" />
          <stop offset="100%" stopColor="#4F46E5" />
        </radialGradient>
      </defs>
    </svg>
  );
}

export function AdminLogin() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [errors, setErrors] = useState<{ identifier?: string; password?: string }>({});
  const [apiError, setApiError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login, user, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && user.role !== 'admin') {
      logout();
    }
  }, [user, logout]);

  if (user) {
    if (user.role === 'admin') {
      return <Navigate to="/admin/dashboard" replace />;
    }
  }

  function validate() {
    const e: typeof errors = {};
    if (!identifier.trim()) e.identifier = 'Username or email is required.';
    if (!password) e.password = 'Password is required.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setApiError('');
    if (!validate()) return;
    setSubmitting(true);
    try {
      await login(identifier, password, 'admin');
      navigate('/admin/dashboard', { replace: true });
    } catch (err: any) {
      setApiError(err.response?.data?.detail || 'Invalid credentials. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Brand */}
        <div className="login-brand">
          <SuperNovaLogo size={56} />
          <div className="login-brand-text">
            <span className="login-brand-name">SuperNova <span style={{ color: '#6366F1' }}>Admin</span></span>
            <span className="login-brand-tagline">System Management Portal</span>
          </div>
        </div>

        <form className="form-stack" onSubmit={handleSubmit} noValidate>
          {/* Username / Email */}
          <div>
            <label htmlFor="admin-identifier">Email Address or Username</label>
            <input
              id="admin-identifier"
              type="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={identifier}
              onChange={(e) => { setIdentifier(e.target.value); setErrors(p => ({ ...p, identifier: undefined })); }}
              className={errors.identifier ? 'field-error' : ''}
              placeholder="admin@supernova.com"
            />
            {errors.identifier && <span className="field-error-msg">{errors.identifier}</span>}
          </div>

          {/* Password */}
          <div>
            <label htmlFor="admin-password">Password</label>
            <div className="password-field">
              <input
                id="admin-password"
                type={showPass ? 'text' : 'password'}
                autoComplete="off"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setErrors(p => ({ ...p, password: undefined })); }}
                className={errors.password ? 'field-error' : ''}
                placeholder=""
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPass(p => !p)}
                aria-label={showPass ? 'Hide password' : 'Show password'}
              >
                {showPass ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
            {errors.password && <span className="field-error-msg">{errors.password}</span>}
          </div>

          {apiError && <div className="inline-error" role="alert">{apiError}</div>}

          <button type="submit" className="btn btn-primary btn-lg" disabled={submitting} style={{ marginTop: 6, background: '#4F46E5', borderColor: '#4F46E5' }}>
            {submitting ? 'Authenticating…' : 'Sign in as Admin'}
          </button>

          <div style={{ marginTop: 12, textAlign: 'center', fontSize: '0.875rem' }}>
            <Link to="/login" style={{ color: '#4F46E5', fontWeight: 600, textDecoration: 'none' }}>
              ← Back to user login
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
