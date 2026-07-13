'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import styles from './page.module.css';
import { supabase } from '@/lib/supabase';

type Role = 'player' | 'organizer';

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
  const [suPassword, setSuPassword] = useState('');
  const [suName, setSuName] = useState('');
  const [suSurname, setSuSurname] = useState('');
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

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setErrorMsg(error.message);
        setLoading(false);
        return;
      }

      // Check role from metadata if it exists
      const userRole = data.user?.user_metadata?.role;
      if (userRole && userRole !== role) {
        await supabase.auth.signOut();
        setErrorMsg(`Account exists, but is registered as a ${userRole}. Please switch role tabs.`);
        setLoading(false);
        return;
      }

      router.push(role === 'organizer' ? '/dashboard' : '/profile');
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred during sign in.');
    } finally {
      setLoading(false);
    }
  };

  const handleSso = async (provider: 'Google' | 'Facebook') => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('oauth_signup_role', role);
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: provider.toLowerCase() as any,
        options: {
          redirectTo: `${window.location.origin}/profile`,
        }
      });
      if (error) {
        setErrorMsg(error.message);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'SSO failed');
    } finally {
      setLoading(false);
    }
  };

  // ── Sign-up modal helpers ──────────────────────────────────────
  const openSignup = () => {
    setSuIdentifier('');
    setSuPassword('');
    setSuName('');
    setSuSurname('');
    setSuError(null);
    setSignupOpen(true);
  };

  const closeSignup = () => setSignupOpen(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuError(null);
    setSuLoading(true);

    try {
      const fullName = role === 'player'
        ? `${suName.trim()} ${suSurname.trim()}`
        : suName.trim();

      const { data, error } = await supabase.auth.signUp({
        email: suIdentifier.trim(),
        password: suPassword,
        options: {
          data: {
            full_name: fullName,
            role: role,
          }
        }
      });

      if (error) {
        setSuError(error.message);
        setSuLoading(false);
        return;
      }

      closeSignup();
      setEmail(suIdentifier.trim());
      setPassword('');
      setSuccessMsg("Account created successfully!\nPlease confirm on your email");
    } catch (err: any) {
      setSuError(err.message || 'An error occurred during account creation.');
    } finally {
      setSuLoading(false);
    }
  };

  const handleSsoSignup = async (provider: 'Google' | 'Facebook') => {
    setSuError(null);
    setSuLoading(true);
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('oauth_signup_role', role);
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: provider.toLowerCase() as any,
        options: {
          redirectTo: `${window.location.origin}/profile`,
        }
      });
      if (error) {
        setSuError(error.message);
      }
    } catch (err: any) {
      setSuError(err.message || 'SSO sign-up failed.');
    } finally {
      setSuLoading(false);
    }
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
                <span>Email address <em className={styles.req}>*</em></span>
                <input
                  type="email"
                  value={suIdentifier}
                  onChange={(e) => setSuIdentifier(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </label>

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

              {role === 'organizer' ? (
                <label className={styles.field}>
                  <span>
                    Organizer&apos;s name <em className={styles.req}>*</em>
                  </span>
                  <input
                    type="text"
                    value={suName}
                    onChange={(e) => setSuName(e.target.value)}
                    placeholder="Khao Lak Volley Club"
                    required
                  />
                </label>
              ) : (
                <div className={styles.nameRow}>
                  <label className={styles.field}>
                    <span>First name <em className={styles.req}>*</em></span>
                    <input
                      type="text"
                      value={suName}
                      onChange={(e) => setSuName(e.target.value)}
                      placeholder="e.g. Alex"
                      required
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Surname <em className={styles.req}>*</em></span>
                    <input
                      type="text"
                      value={suSurname}
                      onChange={(e) => setSuSurname(e.target.value)}
                      placeholder="e.g. Svensson"
                      required
                    />
                  </label>
                </div>
              )}

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
