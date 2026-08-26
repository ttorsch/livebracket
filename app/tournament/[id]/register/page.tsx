'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Check, ChevronRight, AlertCircle } from 'lucide-react';
import styles from './page.module.css';
import { getTournamentDetail, type TournamentDetail, type DetailDivision } from '../../../../lib/data';
import { targetFor, type RegField } from '../../../../lib/registrationFields';
import { divisionRegistrationState } from '../../../../lib/tournamentLifecycle';

const STEPS = ['Division', 'Roster', 'Review'];

/* A player's answers, keyed the way the API wants them: the four questions
   with a column of their own are named, everything else is a free bag. */
interface PlayerAnswers {
  name: string;
  phone: string;
  email: string;
  shirtSize: string;
  custom: Record<string, string>;
}

const emptyPlayer = (): PlayerAnswers => ({ name: '', phone: '', email: '', shirtSize: '', custom: {} });

function readAnswer(p: PlayerAnswers, field: RegField): string {
  const target = targetFor(field);
  return target === 'custom' ? p.custom[field.id] ?? '' : p[target];
}

/* "July 10, 2025" from a stored 'YYYY-MM-DD'. Read in UTC to match how the
   rest of the app renders dates — a browser west of Greenwich would
   otherwise show the deadline a day early. */
function formatDeadline(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

interface SubmitResult {
  teamName: string;
  status: 'unpaid' | 'waitlist';
  fee: number;
  divisionName: string;
}

export default function TournamentRegister() {
  const params = useParams();
  const slug = String(params.id);

  const [tournament, setTournament] = useState<TournamentDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState(0);
  const [divisionId, setDivisionId] = useState('');
  const [players, setPlayers] = useState<PlayerAnswers[]>([]);
  const [pdpa, setPdpa] = useState(false);
  const [rules, setRules] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTournamentDetail(slug)
      .then(data => { if (!cancelled) { setTournament(data); setLoading(false); } })
      .catch(err => {
        if (!cancelled) { setLoadError(err instanceof Error ? err.message : 'Failed to load'); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, [slug]);

  /* Divisions past their close date can't be joined, so they aren't offered.
     A division at cap still is — it takes teams onto its waitlist. */
  const openDivisions = useMemo(
    () => (tournament?.divisions ?? []).filter(d => divisionRegistrationState(d) !== 'closed'),
    [tournament],
  );

  const selectedDiv: DetailDivision | undefined = openDivisions.find(d => d.id === divisionId);

  /* Each division brings its own roster size and question list, so picking one
     starts the roster over rather than carrying answers to questions the new
     division never asked. */
  const chooseDivision = (div: DetailDivision) => {
    setDivisionId(div.id);
    setPlayers(Array.from({ length: div.rosterSize }, emptyPlayer));
  };

  const regFields = selectedDiv?.regFields ?? [];
  const teamName = players.map(p => p.name.trim()).filter(Boolean).join('/');

  const canStep1 = !!selectedDiv;
  const canStep2 =
    players.length > 0 &&
    players.every(p =>
      p.name.trim() && regFields.every(f => !f.required || readAnswer(p, f).trim()),
    );
  const canStep3 = pdpa && rules;

  const updatePlayer = (i: number, field: RegField, value: string) => {
    const target = targetFor(field);
    setPlayers(prev => prev.map((p, idx) => {
      if (idx !== i) return p;
      if (target === 'custom') return { ...p, custom: { ...p.custom, [field.id]: value } };
      return { ...p, [target]: value };
    }));
  };

  const submit = async () => {
    if (!selectedDiv || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/tournaments/${slug}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ divisionId: selectedDiv.id, players }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Registration failed');
      setResult(data as SubmitResult);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Load / empty states ──────────────────────────────────────── */
  if (loading) {
    return (
      <Shell slug={slug}>
        <div className={styles.card}>
          <h2 className={styles.stepTitle}>Choose a division</h2>
          <p className={styles.stepSub}>Loading this event&apos;s divisions…</p>
          <div className={styles.skeletonRow} />
          <div className={styles.skeletonRow} />
        </div>
      </Shell>
    );
  }

  if (loadError || !tournament) {
    return (
      <Shell slug={slug}>
        <div className={`${styles.card} ${styles.stateCard}`}>
          <div className={styles.stateTitle}>This event isn&apos;t available</div>
          <p>{loadError ?? 'We couldn’t find a tournament at this address.'}</p>
          <div className={styles.successActions}>
            <Link href="/" className={styles.btnPrimary}>Browse events</Link>
          </div>
        </div>
      </Shell>
    );
  }

  if (tournament.cancelled) {
    return (
      <Shell slug={slug}>
        <div className={`${styles.card} ${styles.stateCard}`}>
          <div className={styles.stateTitle}>{tournament.title} has been cancelled</div>
          <p>This event is no longer taking registrations.</p>
          <div className={styles.successActions}>
            <Link href={`/tournament/${slug}`} className={styles.btnPrimary}>Back to tournament</Link>
          </div>
        </div>
      </Shell>
    );
  }

  if (openDivisions.length === 0) {
    return (
      <Shell slug={slug}>
        <div className={`${styles.card} ${styles.stateCard}`}>
          <div className={styles.stateTitle}>Registration is closed</div>
          <p>No division at {tournament.title} is taking teams right now.</p>
          <div className={styles.successActions}>
            <Link href={`/tournament/${slug}`} className={styles.btnPrimary}>Back to tournament</Link>
          </div>
        </div>
      </Shell>
    );
  }

  /* ── Success ──────────────────────────────────────────────────── */
  if (result) {
    const waitlisted = result.status === 'waitlist';
    return (
      <div className={styles.page}>
        <TopBar id={slug} />
        <div className={styles.successWrapper}>
          <div className={styles.successCard}
            style={{ backdropFilter: 'blur(18px) saturate(150%)', WebkitBackdropFilter: 'blur(18px) saturate(150%)' }}
          >
            <div className={styles.successIcon}>
              <Check size={32} strokeWidth={3} />
            </div>
            <h2 className={styles.successTitle}>
              {waitlisted ? 'You’re on the waitlist!' : 'Registration submitted!'}
            </h2>
            <p className={styles.successSub}>
              {waitlisted ? (
                <>
                  <strong>{result.teamName}</strong> is on the waitlist for <strong>{result.divisionName}</strong>.
                  You&apos;ll be moved up if a team drops out — no payment is due yet.
                </>
              ) : (
                <>
                  <strong>{result.teamName}</strong> is registered for <strong>{result.divisionName}</strong>.
                  Your spot is reserved for 24 hours. Complete payment of{' '}
                  <strong>{result.fee.toLocaleString()} THB</strong> to confirm.
                </>
              )}
            </p>
            {selectedDiv?.confirmationMessage && (
              <div className={styles.rulesBlock}>{selectedDiv.confirmationMessage}</div>
            )}
            {!waitlisted && (
              <div className={styles.successInfo}>
                <AlertCircle size={14} />
                Payment window: 24 hours from now. Unpaid registrations are released automatically.
              </div>
            )}
            <div className={styles.successActions}>
              <Link href={`/tournament/${slug}`} className={styles.btnPrimary}>
                Back to tournament
              </Link>
              <Link href="/" className={styles.btnGhost}>Browse more events</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Wizard ───────────────────────────────────────────────────── */
  return (
    <div className={styles.page}>
      <TopBar id={slug} />

      {/* ── Progress stepper ──────────────────────────────────── */}
      <div className={styles.stepper}>
        <div className={styles.container}>
          <div className={styles.stepperInner}>
            {STEPS.map((label, i) => (
              <div key={label} className={styles.stepWrap}>
                <div className={`${styles.stepCircle} ${i < step ? styles.stepDone : ''} ${i === step ? styles.stepActive : ''}`}>
                  {i < step ? <Check size={14} strokeWidth={3} /> : i + 1}
                </div>
                <span className={`${styles.stepLabel} ${i === step ? styles.stepLabelActive : ''}`}>{label}</span>
                {i < STEPS.length - 1 && <div className={`${styles.stepLine} ${i < step ? styles.stepLineDone : ''}`} />}
              </div>
            ))}
          </div>
        </div>
      </div>

      <main className={styles.main}>
        <div className={styles.container}>
          <div className={styles.card}
            style={{ backdropFilter: 'blur(18px) saturate(150%)', WebkitBackdropFilter: 'blur(18px) saturate(150%)' }}
          >

            {/* ── Step 1: Division ──────────────────────────────── */}
            {step === 0 && (
              <div>
                <h2 className={styles.stepTitle}>Choose a division</h2>
                <p className={styles.stepSub}>Select the division you&apos;d like to enter. Fees are per team.</p>
                <div className={styles.divisionGrid}>
                  {openDivisions.map(div => {
                    const full = div.filled >= div.teams;
                    const waitlistFull = full && div.waitlistCap <= 0;
                    return (
                      <button
                        key={div.id}
                        disabled={waitlistFull}
                        className={`${styles.divCard} ${divisionId === div.id ? styles.divCardActive : ''} ${waitlistFull ? styles.divCardFull : ''}`}
                        onClick={() => !waitlistFull && chooseDivision(div)}
                      >
                        <div className={styles.divCardTop}>
                          <span className={styles.divLabel}>{div.label}</span>
                          {waitlistFull
                            ? <span className={styles.divFullBadge}>Full</span>
                            : full && <span className={styles.divWaitBadge}>Waitlist</span>}
                        </div>
                        <div className={styles.divFee}>
                          {div.registrationFee.toLocaleString()} <span className={styles.divCurrency}>THB</span>
                        </div>
                        <div className={styles.divMeta}>
                          <span>{div.filled}/{div.teams} teams registered</span>
                          <span>
                            {div.registrationCloses
                              ? `Deadline: ${formatDeadline(div.registrationCloses)}`
                              : 'No deadline'}
                          </span>
                        </div>
                        <div className={styles.divProgress}>
                          <div
                            className={styles.divProgressBar}
                            style={{ width: `${Math.min(100, (div.filled / Math.max(1, div.teams)) * 100)}%` }}
                          />
                        </div>
                        {full && !waitlistFull && (
                          <div className={styles.divNote}>
                            This division is full — you&apos;ll join the waitlist.
                          </div>
                        )}
                        {divisionId === div.id && (
                          <div className={styles.divCheck}><Check size={14} strokeWidth={3} /></div>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className={styles.stepFooter}>
                  <Link href={`/tournament/${slug}`} className={styles.btnGhost}>Cancel</Link>
                  <button
                    className={styles.btnPrimary}
                    disabled={!canStep1}
                    onClick={() => canStep1 && setStep(1)}
                  >
                    Continue <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 2: Roster ────────────────────────────────── */}
            {step === 1 && selectedDiv && (
              <div>
                <h2 className={styles.stepTitle}>Team roster</h2>
                <p className={styles.stepSub}>
                  {selectedDiv.label} is a {selectedDiv.formatTypeOnSand} division — enter details for
                  all {players.length} player{players.length === 1 ? '' : 's'}.
                </p>

                {/* Teams are named after their players everywhere in Live
                    Bracket — the bracket, the schedule, the score screen —
                    so the name is derived here rather than typed. */}
                <div className={styles.teamNamePreview}>
                  <span className={styles.teamNamePreviewLabel}>Your team will appear as</span>
                  <span className={styles.teamNamePreviewValue}>{teamName || '—'}</span>
                </div>

                {players.map((player, i) => (
                  <div key={i} className={styles.playerBlock}>
                    <div className={styles.playerBlockHeader}>Player {i + 1}</div>
                    <div className={styles.playerFields}>
                      {regFields.map(field => (
                        <div key={field.id} className={styles.fieldGroup}>
                          <label className={styles.fieldLabel}>
                            {field.label}
                            {field.required ? ' *' : <span className={styles.optionalTag}> (optional)</span>}
                          </label>
                          {field.type === 'select' ? (
                            <select
                              className={styles.select}
                              value={readAnswer(player, field)}
                              onChange={e => updatePlayer(i, field, e.target.value)}
                            >
                              <option value="">Select…</option>
                              {(field.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : field.type === 'paragraph' ? (
                            <textarea
                              className={`${styles.input} ${styles.textarea}`}
                              placeholder={field.label}
                              value={readAnswer(player, field)}
                              onChange={e => updatePlayer(i, field, e.target.value)}
                            />
                          ) : (
                            <input
                              className={styles.input}
                              type={field.type === 'phone' ? 'tel' : field.type === 'email' ? 'email' : 'text'}
                              placeholder={field.type === 'phone' ? '+66 XX XXX XXXX' : field.type === 'email' ? 'you@example.com' : field.label}
                              value={readAnswer(player, field)}
                              onChange={e => updatePlayer(i, field, e.target.value)}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                <div className={styles.stepFooter}>
                  <button className={styles.btnGhost} onClick={() => setStep(0)}>Back</button>
                  <button
                    className={styles.btnPrimary}
                    disabled={!canStep2}
                    onClick={() => canStep2 && setStep(2)}
                  >
                    Review &amp; confirm <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 3: Review + T&C ─────────────────────────── */}
            {step === 2 && selectedDiv && (
              <div>
                <h2 className={styles.stepTitle}>Review &amp; confirm</h2>
                <p className={styles.stepSub}>Check your details before submitting. You&apos;ll have 24 hours to complete payment.</p>

                <div className={styles.reviewBlock}>
                  <div className={styles.reviewRow}>
                    <span className={styles.reviewLabel}>Division</span>
                    <span className={styles.reviewValue}>{selectedDiv.label}</span>
                  </div>
                  <div className={styles.reviewRow}>
                    <span className={styles.reviewLabel}>Team name</span>
                    <span className={styles.reviewValue}>{teamName}</span>
                  </div>
                  {players.map((p, i) => (
                    <div key={i} className={styles.reviewRow}>
                      <span className={styles.reviewLabel}>Player {i + 1}</span>
                      <span className={styles.reviewValue}>{p.name}</span>
                    </div>
                  ))}
                  <div className={`${styles.reviewRow} ${styles.reviewRowFee}`}>
                    <span className={styles.reviewLabel}>Registration fee</span>
                    <span className={styles.reviewFee}>{selectedDiv.registrationFee.toLocaleString()} THB</span>
                  </div>
                </div>

                <div className={styles.paymentNotice}>
                  <AlertCircle size={16} />
                  <p>
                    You have <strong>24 hours</strong> from submission to complete payment. Your spot will be released if payment isn&apos;t received in time.
                  </p>
                </div>

                {selectedDiv.rules && (
                  <div className={styles.rulesBlock}>{selectedDiv.rules}</div>
                )}

                <div className={styles.consentBlock}>
                  <label className={styles.consentRow}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={rules}
                      onChange={e => setRules(e.target.checked)}
                    />
                    <span>I have read and agree to the tournament rules and code of conduct</span>
                  </label>
                  <label className={styles.consentRow}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={pdpa}
                      onChange={e => setPdpa(e.target.checked)}
                    />
                    <span>
                      I consent to the collection and use of my personal data for event management purposes in accordance with Thailand&apos;s PDPA
                    </span>
                  </label>
                </div>

                {submitError && (
                  <div className={styles.formError}>
                    <AlertCircle size={16} />
                    <span>{submitError}</span>
                  </div>
                )}

                <div className={styles.stepFooter}>
                  <button className={styles.btnGhost} onClick={() => setStep(1)} disabled={submitting}>Back</button>
                  <button
                    className={styles.btnPrimary}
                    disabled={!canStep3 || submitting}
                    onClick={submit}
                  >
                    {submitting ? 'Submitting…' : 'Submit registration'}
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </main>
    </div>
  );
}

/* ── Page chrome shared by the wizard and its load/empty states ── */
function Shell({ slug, children }: { slug: string; children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <TopBar id={slug} />
      <main className={styles.main}>
        <div className={styles.container}>{children}</div>
      </main>
    </div>
  );
}

/* ── Shared top bar ───────────────────────────────────────────── */
function TopBar({ id }: { id: string }) {
  return (
    <header className={styles.topBar}>
      <div className={styles.container}>
        <div className={styles.topBarInner}>
          <Link href="/" className={styles.brand}>
            <span className={styles.brandMark}>
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
          <Link href={`/tournament/${id}`} className={styles.topBack}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M12 7H2m0 0l4 4M2 7l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to event
          </Link>
        </div>
      </div>
    </header>
  );
}
