import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Role, useAuth } from '../auth/AuthContext';

/** Supernova AI — custom SVG logo mark */
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
      {/* Outer glow ring */}
      <circle cx="32" cy="32" r="30" fill="url(#snGlow)" opacity="0.18" />
      {/* Burst rays */}
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
            stroke={i % 2 === 0 ? '#0F766E' : '#14B8A6'}
            strokeWidth={i % 2 === 0 ? 3 : 2}
            strokeLinecap="round"
          />
        );
      })}
      {/* Core ring */}
      <circle cx="32" cy="32" r="10" fill="url(#snCore)" />
      {/* Inner bright dot */}
      <circle cx="32" cy="32" r="4.5" fill="#ffffff" opacity="0.95" />
      {/* Tiny sparkle crosshairs */}
      <line x1="32" y1="18" x2="32" y2="22" stroke="#5EEAD4" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="32" y1="42" x2="32" y2="46" stroke="#5EEAD4" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="18" y1="32" x2="22" y2="32" stroke="#5EEAD4" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="42" y1="32" x2="46" y2="32" stroke="#5EEAD4" strokeWidth="1.5" strokeLinecap="round" />
      <defs>
        <radialGradient id="snGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0F766E" />
          <stop offset="100%" stopColor="#0F766E" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="snCore" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#2DD4BF" />
          <stop offset="100%" stopColor="#0F766E" />
        </radialGradient>
      </defs>
    </svg>
  );
}

export function Login() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [role, setRole] = useState<Role>('sonologist');
  const [errors, setErrors] = useState<{ identifier?: string; password?: string }>({});
  const [apiError, setApiError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

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
      const user = await login(identifier, password, role);
      navigate(user.role === 'sonologist' ? '/dashboard' : '/review', { replace: true });
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
            <span className="login-brand-name">SuperNova <span>AI</span></span>
            <span className="login-brand-tagline">Clinical Ultrasound Intelligence</span>
          </div>
        </div>

        <form className="form-stack" onSubmit={handleSubmit} noValidate>
          {/* Role selector */}
          <div>
            <label style={{ marginBottom: 10, display: 'block' }}>Sign in as</label>
            <div className="role-selector">
              {(['sonologist', 'expert_reviewer'] as Role[]).map((r) => (
                <label key={r} className={`role-option ${role === r ? 'selected' : ''}`}>
                  <input type="radio" name="role" value={r} checked={role === r} onChange={() => { setRole(r); setIdentifier(''); setPassword(''); }} />
                  <span className="role-option-icon">{r === 'sonologist' ? '🩺' : '🔬'}</span>
                  <span className="role-option-name">{r === 'sonologist' ? 'Sonologist' : 'Expert Reviewer'}</span>
                  <span className="role-option-desc">{r === 'sonologist' ? 'Upload & submit scans' : 'Review & approve cases'}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Username / Email */}
          <div>
            <label htmlFor="login-identifier">Username or Email</label>
            <input
              id="login-identifier"
              key={`id-${role}`}
              type="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={identifier}
              onChange={(e) => { setIdentifier(e.target.value); setErrors(p => ({ ...p, identifier: undefined })); }}
              className={errors.identifier ? 'field-error' : ''}
              placeholder=""
              aria-describedby={errors.identifier ? 'identifier-error' : undefined}
            />
            {errors.identifier && <span id="identifier-error" className="field-error-msg">{errors.identifier}</span>}
          </div>

          {/* Password */}
          <div>
            <label htmlFor="login-password">Password</label>
            <div className="password-field">
              <input
                id="login-password"
                key={`pw-${role}`}
                type={showPass ? 'text' : 'password'}
                autoComplete="off"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setErrors(p => ({ ...p, password: undefined })); }}
                className={errors.password ? 'field-error' : ''}
                placeholder=""
                aria-describedby={errors.password ? 'password-error' : undefined}
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
            {errors.password && <span id="password-error" className="field-error-msg">{errors.password}</span>}
          </div>

          {apiError && <div className="inline-error" role="alert">{apiError}</div>}

          <button type="submit" className="btn btn-primary btn-lg" disabled={submitting} style={{ marginTop: 6 }}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>

          <div style={{ marginTop: 12, textAlign: 'center', fontSize: '0.875rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>System Administrator? </span>
            <Link to="/admin" style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>
              Admin Login
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
