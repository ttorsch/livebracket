'use client';

import { Suspense, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import styles from './page.module.css';
import { supabase } from '@/lib/supabase';
import { signInDestination } from '@/lib/authRedirect';

type Role = 'player' | 'organizer';

/* Long enough to read as one panel passing the other, short enough that the
   form is ready by the time the hand reaches it. */
const PANEL_SWAP = { type: 'spring' as const, stiffness: 220, damping: 30 };

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

function LiveBracketLoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  /* Where middleware.ts wanted to send them before it bounced them here.
   * Only same-origin paths are honoured — an attacker-supplied absolute
   * URL would turn the login into an open redirect. */
  const rawNext = searchParams.get('next');
  const nextPath = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : null;

  /* Which tab opens first. Entry points say where they came from — "Sign in"
   * in the public nav means a player, "Create a tournament" means an
   * organizer — so the form starts on the tab that matches the intent
   * instead of making half the visitors switch. Only a hint: the account's
   * real role is still settled server-side after sign-in. */
  const roleParam = searchParams.get('role');
  const [role, setRole] = useState<Role>(roleParam === 'player' ? 'player' : 'organizer');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(
    searchParams.get('reset') === '1'
      ? 'Password updated. Log in with your new password.'
      : null
  );

  /* Signed in, chose the Organizer tab, but this account has no organizers
   * row yet. Rather than rejecting them — roles are additive, so nothing is
   * wrong with the account — the form offers to add the capability. */
  const [needsOrganizer, setNeedsOrganizer] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [orgClub, setOrgClub] = useState('');

  /* ── Sign-up modal state ────────────────────────────────────────
   * `mode=signup` opens the modal straight away. Entry points that promise a
   * new account — "Create a tournament" — send it, so they land on the form
   * that matches the promise; "Organizer login" omits it and gets the login
   * form. Anything other than 'signup' is ignored, so a stray value just
   * falls back to the login form. */
  const [signupOpen, setSignupOpen] = useState(searchParams.get('mode') === 'signup');
  const [suIdentifier, setSuIdentifier] = useState('');
  const [suPassword, setSuPassword] = useState('');
  const [suName, setSuName] = useState('');
  const [suSurname, setSuSurname] = useState('');
  const [suLoading, setSuLoading] = useState(false);
  const [suError, setSuError] = useState<string | null>(null);

  const content = ROLE_CONTENT[role];

  /* Destination & back-label logic:
   * If coming from a tournament/event page (/tournament/[id] or /tournament/[id]/register), label as 'Event'.
   * Otherwise (homepage or direct visit), label as 'Home'. */
  const isTournament =
    Boolean(nextPath?.startsWith('/tournament')) ||
    (typeof document !== 'undefined' && Boolean(document.referrer && document.referrer.includes('/tournament/')));
  const backLabel = isTournament ? 'Event' : 'Home';

  const handleGoBack = () => {
    if (typeof window !== 'undefined') {
      const hasInternalHistory = sessionStorage.getItem('lb_has_internal_history') === '1';
      if ((hasInternalHistory || nextPath) && window.history.length > 1) {
        sessionStorage.removeItem('lb_has_internal_history');
        router.back();
        return;
      }
    }
    router.push(nextPath || '/');
  };

  const handleRoleChange = (newRole: Role) => {
    setRole(newRole);
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setErrorMsg(error.message);
        setLoading(false);
        return;
      }

      /* What this account can do is a server question — the organizers
       * table decides it, not the tab that was clicked and not
       * user_metadata, which this browser could have written itself. */
      const res = await fetch('/api/auth/session', { cache: 'no-store' });
      const session = await res.json();

      /* A password sign-in never passes through /auth/callback, so this is
       * where it picks up any team registered anonymously with this
       * address. Fire-and-forget: the sign-in does not wait on it, and a
       * failure costs nothing but a later retry. */
      void fetch('/api/auth/claim', { method: 'POST' }).catch(() => {});

      if (!session.signedIn) {
        setErrorMsg('Signed in, but the session could not be established. Try again.');
        setLoading(false);
        return;
      }

      /* The tab is a destination, not a verdict on the account. Player
       * always works — everyone who has an account is a player — so it just
       * resumes wherever they were before signing in. */
      if (role === 'player') {
        router.push(signInDestination('player', nextPath));
        router.refresh();
        return;
      }

      /* Organizer is a capability this account may not have yet. Staying
       * signed in and offering to add it beats signing them back out. */
      if (!session.roles?.includes('organizer')) {
        setOrgName(session.name ?? '');
        setNeedsOrganizer(true);
        setLoading(false);
        return;
      }

      router.push(signInDestination('organizer', nextPath));
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'An error occurred during sign in.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateOrganizer = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/organizer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: orgName, club: orgClub || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error ?? 'Could not create the organizer profile.');
        setLoading(false);
        return;
      }
      router.push(signInDestination('organizer', nextPath));
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not create the organizer profile.');
      setLoading(false);
    }
  };

  /* Backing out of the organizer step leaves them signed in — they are
   * still a player, and that half of the account works fine. */
  const cancelOrganizerSetup = () => {
    setNeedsOrganizer(false);
    setErrorMsg(null);
    router.push(signInDestination('player', nextPath));
  };

  const handleSso = async (provider: 'Google' | 'Facebook') => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);
    try {
      /* OAuth must return through /auth/callback so the code is exchanged
       * for a session server-side; pointing it at a page instead leaves the
       * server with no cookie and the visitor looking signed out. The role
       * rides along as the intent used to provision an organizer row on
       * first arrival (see ensureOrganizerForUser). */
      const callback = new URL('/auth/callback', window.location.origin);
      callback.searchParams.set('role', role);
      if (nextPath) callback.searchParams.set('next', nextPath);

      const { error } = await supabase.auth.signInWithOAuth({
        provider: provider.toLowerCase() as 'google' | 'facebook',
        options: {
          redirectTo: callback.toString(),
          queryParams: { prompt: 'select_account' },
        },
      });
      if (error) {
        setErrorMsg(error.message);
        setLoading(false);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Sign-in with that provider failed.');
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
          /* `role` here is an intent, not a permission. The server reads it
           * once, in ensureOrganizerForUser, to decide whether to create
           * this person their own organizers row — which is exactly what
           * the button they pressed promises. Nothing authorises off it. */
          data: { full_name: fullName, role },
          emailRedirectTo: `${window.location.origin}/auth/callback?type=signup`,
        },
      });

      if (error) {
        setSuError(error.message);
        setSuLoading(false);
        return;
      }

      /* With email confirmation on, signing up an address that already has
       * an account does not error — Supabase returns a decoy user with no
       * identities, so a signup form cannot be used to discover who is
       * registered. Left unhandled it reads as success and no mail ever
       * arrives, so detect it and send them to log in instead. Adding the
       * organizer capability is something the login form now offers. */
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setSuError(
          role === 'organizer'
            ? 'An account already exists for this email. Log in instead — you can add an organizer profile straight after signing in.'
            : 'An account already exists for this email. Log in instead, or reset your password.'
        );
        setSuLoading(false);
        return;
      }

      closeSignup();
      setEmail(suIdentifier.trim());
      setPassword('');
      setSuccessMsg('Account created. Check your email for the confirmation link.');
    } catch (err) {
      setSuError(err instanceof Error ? err.message : 'An error occurred during account creation.');
    } finally {
      setSuLoading(false);
    }
  };

  /* Signing up with Google/Facebook and signing in with them are the same
   * OAuth round trip — the provider, not us, knows whether the account is
   * new. The only difference is which spinner turns, so the modal reuses
   * the sign-in path and reports errors into its own slot. */
  const handleSsoSignup = async (provider: 'Google' | 'Facebook') => {
    setSuError(null);
    setSuLoading(true);
    try {
      const callback = new URL('/auth/callback', window.location.origin);
      callback.searchParams.set('role', role);

      const { error } = await supabase.auth.signInWithOAuth({
        provider: provider.toLowerCase() as 'google' | 'facebook',
        options: {
          redirectTo: callback.toString(),
          queryParams: { prompt: 'select_account' },
        },
      });
      if (error) {
        setSuError(error.message);
        setSuLoading(false);
      }
    } catch (err) {
      setSuError(err instanceof Error ? err.message : 'Sign-up with that provider failed.');
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
          LIVE BRACKET
        </Link>
      </header>

      {/* ── Login hero ──────────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={styles.heroBg} aria-hidden="true">
          <img src="/images/Hero.jpg" alt="" className={styles.heroImg} />
          <div className={styles.heroScrim} />
        </div>

        <div className={styles.modalWrapper}>
          <button
            type="button"
            onClick={handleGoBack}
            className={styles.backLink}
            aria-label={`Go back to ${backLabel}`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            <span>{backLabel}</span>
          </button>

          {/* Organizer signs in from the right — the two panels trade sides,
              and Framer animates the swap so the form is followed across
              rather than found again. Wide layouts only; stacked, the form
              stays on top either way. */}
          <div
            className={`${styles.glassPanel} ${role === 'organizer' ? styles.glassPanelSwapped : ''}`}
            style={{
              backdropFilter: 'blur(18px) saturate(150%)',
              WebkitBackdropFilter: 'blur(18px) saturate(150%)',
            }}
          >
          {/* The login card — left for a player, right for an organizer. */}
          <motion.div
            layout
            transition={PANEL_SWAP}
            className={styles.loginCard}
            style={{ '--role-accent': content.accent } as React.CSSProperties}
          >
            <h2 className={styles.loginTitle}>
              {needsOrganizer ? 'Set up your organizer profile' : content.title}
            </h2>

            <div
              className={styles.roleTabs}
              role="tablist"
              aria-label="Account type"
              hidden={needsOrganizer}
            >
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

            {needsOrganizer ? (
              <>
                <p className={styles.stepNote}>
                  You&apos;re signed in. This account doesn&apos;t run any events yet — add an
                  organizer profile and you&apos;ll keep your player account exactly as it is.
                </p>
                <form className={styles.form} onSubmit={handleCreateOrganizer}>
                  <label className={styles.field}>
                    <span>Organizer&apos;s name <em className={styles.req}>*</em></span>
                    <input
                      type="text"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="Khao Lak Volley Club"
                      required
                      autoFocus
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Club <span className={styles.optional}>(optional)</span></span>
                    <input
                      type="text"
                      value={orgClub}
                      onChange={(e) => setOrgClub(e.target.value)}
                      placeholder="e.g. Khao Lak Volley"
                    />
                  </label>
                  <button type="submit" className={styles.signIn} disabled={loading}>
                    {loading ? 'Creating…' : 'Create organizer profile'}
                  </button>
                  <button type="button" className={styles.forgot} onClick={cancelOrganizerSetup}>
                    Not now — continue as a player
                  </button>
                </form>
              </>
            ) : (
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
              <Link href="/forgot-password" className={styles.forgot}>
                Forgot your password?
              </Link>
            </form>
            )}

            {!needsOrganizer && (
              <>
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
              </>
            )}
          </motion.div>

          {/* The slogan — the side the card is not on. */}
          <motion.div layout transition={PANEL_SWAP} className={styles.heroAside}>
            <p className={styles.asideEyebrow}>Real-time tournament brackets</p>
            <h3 className={styles.asideTitle}>{content.asideTitle}</h3>
            <p className={styles.asideSub}>{content.asideSub}</p>

          </motion.div>
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

/* useSearchParams opts the tree into client-side rendering, so the page has
 * to hand Next a boundary to prerender in its place. */
export default function LiveBracketLogin() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100svh', background: '#0E1722' }} />}>
      <LiveBracketLoginInner />
    </Suspense>
  );
}
