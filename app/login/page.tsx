'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';

type Role = 'player' | 'organizer';

function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 7h10m0 0L8 3m4 4L8 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function LiveBracketLogin() {
  const router = useRouter();
  const [role, setRole] = useState<Role>('organizer');
  const [email, setEmail] = useState('organizer@livebracket.com');
  const [password, setPassword] = useState('password123');

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

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

    if (mode === 'signin') {
      router.push(role === 'organizer' ? '/dashboard' : '/');
    } else {
      setSuccessMsg('Account created successfully! You can now sign in.');
      setMode('signin');
    }

    setLoading(false);
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
          <div className={styles.loginCard}>
            <h2 className={styles.loginTitle}>{mode === 'signin' ? 'Log in' : 'Sign up'}</h2>

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
                {loading ? 'Processing...' : mode === 'signin' ? `Sign in as ${role}` : `Create ${role} account`}
              </button>
            </form>

            <p className={styles.signupNote}>
              {mode === 'signin' ? (
                <>
                  New to Live Bracket?{' '}
                  <button type="button" className={styles.modeToggleBtn} onClick={() => setMode('signup')}>
                    Sign up now
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button type="button" className={styles.modeToggleBtn} onClick={() => setMode('signin')}>
                    Sign in here
                  </button>
                </>
              )}
            </p>
          </div>

          {/* Right: slogan + live event preview */}
          <div className={styles.heroAside}>
            <p className={styles.asideEyebrow}>Real-time tournament brackets</p>
            <h3 className={styles.asideTitle}>
              Run the draw. <em>Share one link.</em> Watch it go live.
            </h3>
            <p className={styles.asideSub}>
              Log in to create a tournament, manage your team, or score a match court-side.
              Just watching? You don&apos;t need an account.
            </p>

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
    </div>
  );
}
