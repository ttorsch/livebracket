'use client';

import { useState } from 'react';
import Link from 'next/link';
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
  // Player / Organizer toggle on the login card (mirrors the Figma tabs).
  const [role, setRole] = useState<Role>('player');
  // Frontend-only form: no real auth, we just show an inline confirmation.
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
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
          // backdrop-filter must be inline — Lightning CSS strips the standard
          // property out of .module.css (keeps only -webkit-), killing the blur.
          style={{
            backdropFilter: 'blur(18px) saturate(150%)',
            WebkitBackdropFilter: 'blur(18px) saturate(150%)',
          }}
        >
          {/* Left: login card */}
          <div className={styles.loginCard}>
            <h2 className={styles.loginTitle}>Log in</h2>

            <div className={styles.roleTabs} role="tablist" aria-label="Account type">
              <button
                role="tab"
                aria-selected={role === 'player'}
                className={`${styles.roleTab} ${role === 'player' ? styles.roleTabActive : ''}`}
                onClick={() => setRole('player')}
              >
                Player
              </button>
              <button
                role="tab"
                aria-selected={role === 'organizer'}
                className={`${styles.roleTab} ${role === 'organizer' ? styles.roleTabActive : ''}`}
                onClick={() => setRole('organizer')}
              >
                Organizer
              </button>
              <span
                className={styles.roleThumb}
                style={{ transform: role === 'organizer' ? 'translateX(100%)' : 'translateX(0)' }}
                aria-hidden="true"
              />
            </div>

            {submitted ? (
              <div className={styles.formDone} role="status">
                <span className={styles.formDoneIcon} aria-hidden="true">✓</span>
                <p>
                  You&apos;re in as a <strong>{role}</strong>. This is a preview — the dashboard isn&apos;t wired up yet.
                </p>
                <button type="button" className={styles.linkBtn} onClick={() => setSubmitted(false)}>
                  Back to login
                </button>
              </div>
            ) : (
              <form className={styles.form} onSubmit={handleSubmit}>
                <label className={styles.field}>
                  <span>Email</span>
                  <input type="email" placeholder="you@example.com" required />
                </label>
                <label className={styles.field}>
                  <span>Password</span>
                  <input type="password" placeholder="••••••••" required />
                </label>
                <button type="submit" className={styles.signIn}>
                  Sign in as {role === 'player' ? 'player' : 'organizer'}
                </button>
                <button type="button" className={styles.forgot}>Forgot password?</button>
              </form>
            )}

            <p className={styles.signupNote}>
              New here? <Link href="/" className={styles.signupLink}>Browse events</Link> — no account needed.
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
