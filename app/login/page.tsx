'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { X, ShieldCheck } from 'lucide-react';
import styles from './page.module.css';

type Role = 'player' | 'organizer';

const DEMO_OTP = '123456';

const ROLE_CONTENT: Record<Role, {
  title: string;
  blurb: string;
  accent: string;
  asideTitle: React.ReactNode;
  asideSub: string;
}> = {
  player: {
    title: 'Player log in',
    blurb: 'Register for tournaments, track your matches and results.',
    accent: '#204ECF',
    asideTitle: <>Find your court. <em>Play the match.</em> Follow it live.</>,
    asideSub:
      'Sign in to register for tournaments, follow your bracket, and get court assignments in real time.',
  },
  organizer: {
    title: 'Organizer log in',
    blurb: 'Create tournaments, manage brackets and live scoring.',
    accent: '#F26749',
    asideTitle: <>Run the draw. <em>Share one link.</em> Watch it go live.</>,
    asideSub:
      'Sign in to create a tournament, seed the bracket, and hand score keepers a court-side scoring link.',
  },
};

function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 7h10m0 0L8 3m4 4L8 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.93-2.91l-3.87-3c-1.07.72-2.44 1.14-4.06 1.14-3.12 0-5.77-2.11-6.71-4.95H1.29v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.29 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.29a12 12 0 0 0 0 10.76l4-3.1z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.6 4.58 1.79l3.44-3.44A11.96 11.96 0 0 0 12 0 12 12 0 0 0 1.29 6.62l4 3.1C6.23 6.88 8.88 4.77 12 4.77z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#1877F2" d="M24 12a12 12 0 1 0-13.88 11.85v-8.38H7.08V12h3.04V9.36c0-3.01 1.79-4.67 4.53-4.67 1.31 0 2.68.23 2.68.23v2.95H15.8c-1.49 0-1.95.92-1.95 1.87V12h3.32l-.53 3.47h-2.79v8.38A12 12 0 0 0 24 12z" />
    </svg>
  );
}

export default function LiveBracketLogin() {
  const router = useRouter();
  const [role, setRole] = useState<Role>('organizer');
  const [email, setEmail] = useState('organizer@livebracket.com');
  const [password, setPassword] = useState('password123');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // ── Sign-up modal state ────────────────────────────────────────
  const [signupOpen, setSignupOpen] = useState(false);
  const [suIdentifier, setSuIdentifier] = useState('');
  const [suOtp, setSuOtp] = useState('');
  const [suOtpSent, setSuOtpSent] = useState(false);
  const [suOtpVerified, setSuOtpVerified] = useState(false);
  const [suPassword, setSuPassword] = useState('');
  const [suName, setSuName] = useState('');
  const [suLoading, setSuLoading] = useState(false);
  const [suError, setSuError] = useState<string | null>(null);

  const content = ROLE_CONTENT[role];

  const handleRoleChange = (newRole: Role) => {
    setRole(newRole);
    setErrorMsg(null);
    setSuccessMsg(null);
    if (newRole === 'organizer') {
      setEmail('organizer@livebracket.com');
      setPassword('password123');
    } else {
      setEmail('player@livebracket.com');
      setPassword('password123');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);

    // Demo auth: no backend wired up. Simulate the request, then route by role.
    await new Promise(resolve => setTimeout(resolve, 400));
    router.push(role === 'organizer' ? '/dashboard' : '/');
    setLoading(false);
  };

  const handleSso = async (provider: 'Google' | 'Facebook') => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);
    // Demo SSO: simulate the provider round-trip, then route by role.
    await new Promise(resolve => setTimeout(resolve, 600));
    void provider;
    router.push(role === 'organizer' ? '/dashboard' : '/');
    setLoading(false);
  };

  // ── Sign-up modal helpers ──────────────────────────────────────
  const openSignup = () => {
    setSuIdentifier('');
    setSuOtp('');
    setSuOtpSent(false);
    setSuOtpVerified(false);
    setSuPassword('');
    setSuName('');
    setSuError(null);
    setSignupOpen(true);
  };

  const closeSignup = () => setSignupOpen(false);

  const identifierValid =
    /\S+@\S+\.\S+/.test(suIdentifier) || /^\+?[0-9()\-\s]{6,}$/.test(suIdentifier.trim());

  const handleSendOtp = () => {
    setSuError(null);
    if (!identifierValid) {
      setSuError('Enter a valid email address or phone number first.');
      return;
    }
    // Demo OTP: no backend, so the code is fixed and hinted in the UI.
    setSuOtp('');
    setSuOtpVerified(false);
    setSuOtpSent(true);
  };

  const handleVerifyOtp = () => {
    setSuError(null);
    if (suOtp === DEMO_OTP) {
      setSuOtpVerified(true);
    } else {
      setSuError('Invalid code. Please try again.');
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuError(null);
    if (!suOtpVerified) {
      setSuError('Please verify your email or phone with the OTP code first.');
      return;
    }
    setSuLoading(true);
    await new Promise(resolve => setTimeout(resolve, 600));
    setSuLoading(false);
    closeSignup();
    if (suIdentifier.includes('@')) setEmail(suIdentifier);
    setSuccessMsg('Account created successfully! You can now sign in.');
  };

  const handleSsoSignup = async (provider: 'Google' | 'Facebook') => {
    setSuError(null);
    setSuLoading(true);
    // Demo SSO sign-up: simulate the provider round-trip, then route by role.
    await new Promise(resolve => setTimeout(resolve, 600));
    void provider;
    setSuLoading(false);
    closeSignup();
    router.push(role === 'organizer' ? '/dashboard' : '/');
  };

  return (
    <div className={styles.page}>
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand} aria-label="Live Bracket — home">
          <span className={styles.brandMark} aria-hidden="true">
            <svg viewBox="296 73 687 687" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="639.5" cy="416.5" r="343.5" fill="#EB6F43" />
  <rect x="428" y="234" width="165.327" height="35.9406" rx="15" fill="white" />
  <rect x="428" y="561.059" width="165.327" height="35.9406" rx="15" fill="white" />
  <rect x="593.327" y="308.277" width="165.327" height="35.9406" rx="15" fill="white" />
  <rect x="722.713" y="462.822" width="129.386" height="35.9406" rx="15" fill="white" />
  <rect x="593.327" y="489.178" width="129.386" height="35.9406" rx="15" fill="white" />
  <rect x="557.386" y="416.099" width="182.099" height="35.9406" rx="15" transform="rotate(-90 557.386 416.099)" fill="white" />
  <rect x="722.713" y="498.762" width="190.485" height="35.9406" rx="15.5" transform="rotate(-90 722.713 498.762)" fill="white" />
  <rect x="557.386" y="597" width="180.901" height="35.9406" rx="15" transform="rotate(-90 557.386 597)" fill="white" />
</svg>
          </span>
          Live Bracket
        </Link>
        <Link href="/" className={styles.topBack}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M12 7H2m0 0l4 4M2 7l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Browse events
        </Link>
      </header>

      {/* ── Login hero ──────────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={styles.heroBg} aria-hidden="true">
          <img src="/images/Hero.jpg" alt="" className={styles.heroImg} />
          <div className={styles.heroScrim} />
        </div>

        <div className={styles.wordmarkWrap}>
          <p className={styles.kicker}>Khao Lak Volley presents</p>
          <h1 className={styles.wordmark}>LIVE BRACKET</h1>
        </div>

        <div
          className={styles.glassPanel}
          style={{
            backdropFilter: 'blur(18px) saturate(150%)',
            WebkitBackdropFilter: 'blur(18px) saturate(150%)',
          }}
        >
          {/* Left: login card */}
          <div
            className={styles.loginCard}
            style={{ '--role-accent': content.accent } as React.CSSProperties}
          >
            <h2 className={styles.loginTitle}>{content.title}</h2>

            <div className={styles.roleTabs} role="tablist" aria-label="Account type">
              <button
                role="tab"
                aria-selected={role === 'player'}
                className={`${styles.roleTab} ${role === 'player' ? styles.roleTabActive : ''}`}
                onClick={() => handleRoleChange('player')}
              >
                Player
              </button>
              <button
                role="tab"
                aria-selected={role === 'organizer'}
                className={`${styles.roleTab} ${role === 'organizer' ? styles.roleTabActive : ''}`}
                onClick={() => handleRoleChange('organizer')}
              >
                Organizer
              </button>
              <span
                className={styles.roleThumb}
                style={{ transform: role === 'organizer' ? 'translateX(100%)' : 'translateX(0)' }}
                aria-hidden="true"
              />
            </div>

            {errorMsg && <div className={styles.alertError}>{errorMsg}</div>}
            {successMsg && <div className={styles.alertSuccess}>{successMsg}</div>}

            <form className={styles.form} onSubmit={handleSubmit}>
              <label className={styles.field}>
                <span>Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </label>
              <label className={styles.field}>
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </label>
              <button type="submit" className={styles.signIn} disabled={loading}>
                {loading ? 'Processing...' : `Sign in as ${role}`}
              </button>
            </form>

            <div className={styles.divider} aria-hidden="true">or continue with</div>

            <div className={styles.ssoRow}>
              <button
                type="button"
                className={styles.ssoBtn}
                onClick={() => handleSso('Google')}
                disabled={loading}
              >
                <GoogleIcon /> Google
              </button>
              <button
                type="button"
                className={styles.ssoBtn}
                onClick={() => handleSso('Facebook')}
                disabled={loading}
              >
                <FacebookIcon /> Facebook
              </button>
            </div>

            <p className={styles.signupNote}>
              New to Live Bracket?{' '}
              <button type="button" className={styles.modeToggleBtn} onClick={openSignup}>
                Sign up now
              </button>
            </p>
          </div>

          {/* Right: slogan + live event preview */}
          <div className={styles.heroAside}>
            <p className={styles.asideEyebrow}>Real-time tournament brackets</p>
            <h3 className={styles.asideTitle}>{content.asideTitle}</h3>
            <p className={styles.asideSub}>{content.asideSub}</p>

            <div
              className={styles.eventPreview}
              style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            >
              <div className={styles.livePill}>
                <span className={styles.liveDot} aria-hidden="true" />
                Live now
              </div>
              <div className={styles.eventPreviewBody}>
                <p className={styles.eventName}>Bang Niang Beach Classic · Final</p>
                <div className={styles.scoreRow}>
                  <span className={styles.team}>Team Sunset</span>
                  <span className={styles.score}>21</span>
                </div>
                <div className={`${styles.scoreRow} ${styles.scoreRowLead}`}>
                  <span className={styles.team}>Team Riptide</span>
                  <span className={styles.score}>23</span>
                </div>
              </div>
              <Link href="/" className={styles.eventLink}>
                See the bracket <Arrow />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Sign-up modal ───────────────────────────────────────── */}
      {signupOpen && (
        <div
          className={styles.modalOverlay}
          onClick={(e) => { if (e.target === e.currentTarget) closeSignup(); }}
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="signup-title"
            style={{ '--role-accent': content.accent } as React.CSSProperties}
          >
            <div className={styles.modalHead}>
              <div>
                <h2 id="signup-title" className={styles.modalTitle}>
                  Create {role} account
                </h2>
                <p className={styles.modalSub}>{content.blurb}</p>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                onClick={closeSignup}
                aria-label="Close sign-up form"
              >
                <X size={18} />
              </button>
            </div>

            {suError && <div className={styles.alertError}>{suError}</div>}

            <form className={styles.form} onSubmit={handleSignup}>
              <label className={styles.field}>
                <span>Email or phone number <em className={styles.req}>*</em></span>
                <div className={styles.otpRow}>
                  <input
                    type="text"
                    value={suIdentifier}
                    onChange={(e) => {
                      setSuIdentifier(e.target.value);
                      setSuOtpSent(false);
                      setSuOtpVerified(false);
                    }}
                    placeholder="you@example.com or +66 81 234 5678"
                    required
                    disabled={suOtpVerified}
                  />
                  {!suOtpVerified && (
                    <button type="button" className={styles.sendCodeBtn} onClick={handleSendOtp}>
                      {suOtpSent ? 'Resend' : 'Send code'}
                    </button>
                  )}
                </div>
              </label>

              {suOtpVerified ? (
                <p className={styles.verifiedBadge}>
                  <ShieldCheck size={16} aria-hidden="true" /> Verified
                </p>
              ) : suOtpSent && (
                <div className={styles.field}>
                  <span>Verification code <em className={styles.req}>*</em></span>
                  <div className={styles.otpRow}>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      className={styles.otpInput}
                      value={suOtp}
                      onChange={(e) => setSuOtp(e.target.value.replace(/\D/g, ''))}
                      placeholder="••••••"
                    />
                    <button type="button" className={styles.sendCodeBtn} onClick={handleVerifyOtp}>
                      Verify
                    </button>
                  </div>
                  <p className={styles.otpHint}>
                    We sent a 6-digit code to {suIdentifier}. (Demo: use {DEMO_OTP})
                  </p>
                </div>
              )}

              <label className={styles.field}>
                <span>Password <em className={styles.req}>*</em></span>
                <input
                  type="password"
                  value={suPassword}
                  onChange={(e) => setSuPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  minLength={8}
                  required
                />
              </label>

              <label className={styles.field}>
                <span>
                  {role === 'organizer' ? <>Organizer&apos;s name</> : <>Player&apos;s name</>}{' '}
                  <em className={styles.req}>*</em>
                </span>
                <input
                  type="text"
                  value={suName}
                  onChange={(e) => setSuName(e.target.value)}
                  placeholder={role === 'organizer' ? 'Khao Lak Volley Club' : 'Your full name'}
                  required
                />
              </label>

              <button type="submit" className={styles.signIn} disabled={suLoading}>
                {suLoading ? 'Creating account...' : `Create ${role} account`}
              </button>
            </form>

            <div className={styles.divider} aria-hidden="true">or sign up with</div>

            <div className={styles.ssoRow}>
              <button
                type="button"
                className={styles.ssoBtn}
                onClick={() => handleSsoSignup('Google')}
                disabled={suLoading}
              >
                <GoogleIcon /> Google
              </button>
              <button
                type="button"
                className={styles.ssoBtn}
                onClick={() => handleSsoSignup('Facebook')}
                disabled={suLoading}
              >
                <FacebookIcon /> Facebook
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
