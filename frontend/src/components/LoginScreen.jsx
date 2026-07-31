import { useEffect, useState } from 'react';
import { Mail, Phone, Lock, AtSign, User as UserIcon, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { api, setToken } from '../api/api.js';
import logo from '../assets/logo.png';

const FIELD_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 transition-colors';

/**
 * Gate shown before the dashboard. Four modes, all in one component so
 * switching between them is an instant local state change rather than
 * a page navigation:
 *   - login    : normal sign-in
 *   - signup   : create an account — on success this returns to
 *                'login' (NOT an auto-login) with a confirmation
 *                banner, so a new user consciously logs in with the
 *                credentials they just chose rather than landing
 *                straight in the dashboard.
 *   - forgot   : request a reset email (always shows the same generic
 *                confirmation regardless of whether the email matched
 *                an account — see authController.forgotPassword)
 *   - reset    : entered automatically when the page loads with a
 *                `?resetToken=` query param (i.e. the person clicked
 *                the emailed link) — set a new password, then back
 *                to 'login'.
 *
 * Every mode switch remounts the inner card content under a fresh
 * `key`, so the existing scaleIn keyframe (same one every modal in
 * this app uses) replays as a quick, consistent transition instead of
 * the form just snapping to new content.
 */
export default function LoginScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'forgot' | 'reset'
  const [resetToken, setResetToken] = useState('');
  const [banner, setBanner] = useState(''); // one-line success message shown after signup/reset

  const [form, setForm] = useState({
    name: '', email: '', password: '',
    notify_channel: 'email', notify_phone: '',
  });
  const [forgotEmail, setForgotEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // A password-reset email link points back here as
  // "/?resetToken=...". Pick that up on load and drop straight into
  // the reset-password mode, then clean the URL so refreshing/
  // bookmarking afterward doesn't re-trigger it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('resetToken');
    if (token) {
      setResetToken(token);
      setMode('reset');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function switchMode(next) {
    setMode(next);
    setError('');
    setBanner('');
  }

  async function handleLoginOrSignup(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'login') {
        const result = await api.login({ email: form.email, password: form.password });
        setToken(result.token);
        onAuthenticated(result.user);
      } else {
        const result = await api.register(form);
        // Deliberately NOT auto-logging in — see component doc comment.
        setForm((f) => ({ ...f, password: '' }));
        switchMode('login');
        setBanner(
          result.user?.is_approved
            ? 'Account created — log in below with your new password.'
            : 'Account created — an admin needs to approve it before you can log in. Check back soon.'
        );
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgotSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await api.forgotPassword(forgotEmail);
      setBanner(result.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetSubmit(e) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await api.resetPassword(resetToken, newPassword);
      switchMode('login');
      setBanner('Password updated — log in with your new password.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 px-4">
      {/* Soft glow behind the card — subtle, not a hard gradient band */}
      <div className="pointer-events-none absolute left-1/2 top-0 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-brand-100/50 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-1/2 h-[420px] w-[420px] translate-x-1/2 translate-y-1/3 rounded-full bg-slate-200/40 blur-3xl" />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src={logo} alt="Sangkaj Group" className="mb-3 h-24 w-auto" />
          <h1 className="text-lg font-semibold text-slate-900">Asset Purchase Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            {mode === 'login' && 'Log in to continue.'}
            {mode === 'signup' && 'Create an account to get started.'}
            {mode === 'forgot' && "We'll email you a link to reset it."}
            {mode === 'reset' && 'Choose a new password.'}
          </p>
        </div>

        {/* Remounting under a mode-keyed wrapper replays the scaleIn
            animation on every switch — a quick, consistent transition
            instead of content just snapping in place. */}
        <div key={mode} className="animate-[scaleIn_0.18s_ease-out] rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_8px_30px_-12px_rgba(39,38,53,0.15)]">
          {banner && (
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
              <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
              <span>{banner}</span>
            </div>
          )}

          {(mode === 'login' || mode === 'signup') && (
            <>
              <div className="mb-5 flex rounded-lg bg-slate-100 p-1 text-sm font-medium">
                <button type="button" onClick={() => switchMode('login')}
                  className={`flex-1 rounded-md py-1.5 transition-colors ${mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  Log in
                </button>
                <button type="button" onClick={() => switchMode('signup')}
                  className={`flex-1 rounded-md py-1.5 transition-colors ${mode === 'signup' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  Sign up
                </button>
              </div>

              <form onSubmit={handleLoginOrSignup} className="space-y-3.5">
                {mode === 'signup' && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">Name</label>
                    <div className="relative">
                      <UserIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input required className={FIELD_CLASS} value={form.name}
                        onChange={(e) => update('name', e.target.value)} placeholder="Your name" />
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Email</label>
                  <div className="relative">
                    <AtSign size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input required type="email" className={FIELD_CLASS} value={form.email}
                      onChange={(e) => update('email', e.target.value)} placeholder="you@company.com" />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="block text-xs font-medium text-slate-500">Password</label>
                    {mode === 'login' && (
                      <button type="button" onClick={() => switchMode('forgot')} className="text-xs font-medium text-brand-600 hover:underline">
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input required type="password" minLength={6} className={FIELD_CLASS} value={form.password}
                      onChange={(e) => update('password', e.target.value)} placeholder="••••••••" />
                  </div>
                </div>

                {mode === 'signup' && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">
                      Where should delivery &amp; payment alerts go?
                    </label>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => update('notify_channel', 'email')}
                        className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-sm transition-colors ${
                          form.notify_channel === 'email' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                        }`}>
                        <Mail size={14} /> Gmail
                      </button>
                      <button type="button" onClick={() => update('notify_channel', 'sms')}
                        className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-sm transition-colors ${
                          form.notify_channel === 'sms' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                        }`}>
                        <Phone size={14} /> Phone (SMS)
                      </button>
                    </div>
                    {form.notify_channel === 'sms' && (
                      <input required type="tel" className="mt-2 w-full rounded-lg border border-slate-200 bg-white py-2.5 px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                        value={form.notify_phone}
                        onChange={(e) => update('notify_phone', e.target.value)} placeholder="+91 98765 43210" />
                    )}
                    {form.notify_channel === 'email' && (
                      <p className="mt-1.5 text-xs text-slate-400">Alerts will be sent to the email above.</p>
                    )}
                  </div>
                )}

                {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

                <button type="submit" disabled={submitting}
                  className="w-full rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:from-brand-600 hover:to-brand-700 disabled:opacity-60 active:scale-95">
                  {submitting ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
                </button>
              </form>
            </>
          )}

          {mode === 'forgot' && (
            <form onSubmit={handleForgotSubmit} className="space-y-3.5">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Email</label>
                <div className="relative">
                  <AtSign size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input required type="email" className={FIELD_CLASS} value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)} placeholder="you@company.com" />
                </div>
              </div>

              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

              <button type="submit" disabled={submitting}
                className="w-full rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:from-brand-600 hover:to-brand-700 disabled:opacity-60 active:scale-95">
                {submitting ? 'Sending…' : 'Send reset link'}
              </button>

              <button type="button" onClick={() => switchMode('login')}
                className="flex w-full items-center justify-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700">
                <ArrowLeft size={12} /> Back to login
              </button>
            </form>
          )}

          {mode === 'reset' && (
            <form onSubmit={handleResetSubmit} className="space-y-3.5">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">New password</label>
                <div className="relative">
                  <Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input required type="password" minLength={6} className={FIELD_CLASS} value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Confirm new password</label>
                <div className="relative">
                  <Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input required type="password" minLength={6} className={FIELD_CLASS} value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" />
                </div>
              </div>

              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

              <button type="submit" disabled={submitting}
                className="w-full rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:from-brand-600 hover:to-brand-700 disabled:opacity-60 active:scale-95">
                {submitting ? 'Updating…' : 'Update password'}
              </button>
            </form>
          )}
        </div>

        {(mode === 'login' || mode === 'signup') && (
          <p className="mt-5 text-center text-xs text-slate-400">
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')} className="font-medium text-brand-600 hover:underline">
              {mode === 'login' ? 'Sign up' : 'Log in'}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
