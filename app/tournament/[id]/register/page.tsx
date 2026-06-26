'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Check, ChevronRight, AlertCircle } from 'lucide-react';
import styles from './page.module.css';

/* ── Sample data ─────────────────────────────────────────────── */
const DIVISIONS = [
  { id: 'open-m', label: "Men's Open", fee: 800, currency: 'THB', filled: 8, total: 8, deadline: 'July 10, 2025' },
  { id: 'open-w', label: "Women's Open", fee: 800, currency: 'THB', filled: 6, total: 8, deadline: 'July 10, 2025' },
  { id: 'mixed', label: 'Mixed', fee: 700, currency: 'THB', filled: 5, total: 8, deadline: 'July 10, 2025' },
];

const STEPS = ['Division', 'Roster', 'Review'];

interface Player { name: string; phone: string; email: string; shirt: string }

export default function TournamentRegister() {
  const params = useParams();
  const [step, setStep] = useState(0);
  const [divisionId, setDivisionId] = useState('');
  const [teamName, setTeamName] = useState('');
  const [players, setPlayers] = useState<Player[]>([
    { name: '', phone: '', email: '', shirt: 'M' },
    { name: '', phone: '', email: '', shirt: 'M' },
  ]);
  const [pdpa, setPdpa] = useState(false);
  const [rules, setRules] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const selectedDiv = DIVISIONS.find(d => d.id === divisionId);
  const canStep1 = !!divisionId && selectedDiv && selectedDiv.filled < selectedDiv.total;
  const canStep2 = !!teamName.trim() && players.every(p => p.name.trim() && p.phone.trim());
  const canStep3 = pdpa && rules;

  const updatePlayer = (i: number, field: keyof Player, value: string) => {
    setPlayers(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: value } : p));
  };

  if (submitted) {
    return (
      <div className={styles.page}>
        <TopBar id={String(params.id)} />
        <div className={styles.successWrapper}>
          <div className={styles.successCard}
            style={{ backdropFilter: 'blur(18px) saturate(150%)', WebkitBackdropFilter: 'blur(18px) saturate(150%)' }}
          >
            <div className={styles.successIcon}>
              <Check size={32} strokeWidth={3} />
            </div>
            <h2 className={styles.successTitle}>Registration submitted!</h2>
            <p className={styles.successSub}>
              Your spot in <strong>{selectedDiv?.label}</strong> is reserved for 24 hours. Complete payment to confirm.
            </p>
            <div className={styles.successInfo}>
              <AlertCircle size={14} />
              Payment window: 24 hours from now. Unpaid registrations are released automatically.
            </div>
            <div className={styles.successActions}>
              <Link href={`/tournament/${params.id}`} className={styles.btnPrimary}>
                Back to tournament
              </Link>
              <Link href="/" className={styles.btnGhost}>Browse more events</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <TopBar id={String(params.id)} />

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
                  {DIVISIONS.map(div => {
                    const full = div.filled >= div.total;
                    return (
                      <button
                        key={div.id}
                        disabled={full}
                        className={`${styles.divCard} ${divisionId === div.id ? styles.divCardActive : ''} ${full ? styles.divCardFull : ''}`}
                        onClick={() => !full && setDivisionId(div.id)}
                      >
                        <div className={styles.divCardTop}>
                          <span className={styles.divLabel}>{div.label}</span>
                          {full && <span className={styles.divFullBadge}>Full</span>}
                        </div>
                        <div className={styles.divFee}>
                          {div.fee.toLocaleString()} <span className={styles.divCurrency}>{div.currency}</span>
                        </div>
                        <div className={styles.divMeta}>
                          <span>{div.filled}/{div.total} teams registered</span>
                          <span>Deadline: {div.deadline}</span>
                        </div>
                        <div className={styles.divProgress}>
                          <div
                            className={styles.divProgressBar}
                            style={{ width: `${(div.filled / div.total) * 100}%` }}
                          />
                        </div>
                        {divisionId === div.id && (
                          <div className={styles.divCheck}><Check size={14} strokeWidth={3} /></div>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className={styles.stepFooter}>
                  <Link href={`/tournament/${params.id}`} className={styles.btnGhost}>Cancel</Link>
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
            {step === 1 && (
              <div>
                <h2 className={styles.stepTitle}>Team roster</h2>
                <p className={styles.stepSub}>Enter your team name and player details. Both players must be listed.</p>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Team name</label>
                  <input
                    className={styles.input}
                    type="text"
                    placeholder="e.g. Sunset Smashers"
                    value={teamName}
                    onChange={e => setTeamName(e.target.value)}
                  />
                </div>

                {players.map((player, i) => (
                  <div key={i} className={styles.playerBlock}>
                    <div className={styles.playerBlockHeader}>Player {i + 1}</div>
                    <div className={styles.playerFields}>
                      <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>Full name *</label>
                        <input
                          className={styles.input}
                          type="text"
                          placeholder="First Last"
                          value={player.name}
                          onChange={e => updatePlayer(i, 'name', e.target.value)}
                        />
                      </div>
                      <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>Phone *</label>
                        <input
                          className={styles.input}
                          type="tel"
                          placeholder="+66 XX XXX XXXX"
                          value={player.phone}
                          onChange={e => updatePlayer(i, 'phone', e.target.value)}
                        />
                      </div>
                      <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>Email</label>
                        <input
                          className={styles.input}
                          type="email"
                          placeholder="you@example.com"
                          value={player.email}
                          onChange={e => updatePlayer(i, 'email', e.target.value)}
                        />
                      </div>
                      <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>Shirt size</label>
                        <select
                          className={styles.select}
                          value={player.shirt}
                          onChange={e => updatePlayer(i, 'shirt', e.target.value)}
                        >
                          {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
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
                    Review & confirm <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 3: Review + T&C ─────────────────────────── */}
            {step === 2 && (
              <div>
                <h2 className={styles.stepTitle}>Review &amp; confirm</h2>
                <p className={styles.stepSub}>Check your details before submitting. You&apos;ll have 24 hours to complete payment.</p>

                <div className={styles.reviewBlock}>
                  <div className={styles.reviewRow}>
                    <span className={styles.reviewLabel}>Division</span>
                    <span className={styles.reviewValue}>{selectedDiv?.label}</span>
                  </div>
                  <div className={styles.reviewRow}>
                    <span className={styles.reviewLabel}>Team name</span>
                    <span className={styles.reviewValue}>{teamName}</span>
                  </div>
                  <div className={styles.reviewRow}>
                    <span className={styles.reviewLabel}>Player 1</span>
                    <span className={styles.reviewValue}>{players[0].name}</span>
                  </div>
                  <div className={styles.reviewRow}>
                    <span className={styles.reviewLabel}>Player 2</span>
                    <span className={styles.reviewValue}>{players[1].name}</span>
                  </div>
                  <div className={`${styles.reviewRow} ${styles.reviewRowFee}`}>
                    <span className={styles.reviewLabel}>Registration fee</span>
                    <span className={styles.reviewFee}>{selectedDiv?.fee.toLocaleString()} {selectedDiv?.currency}</span>
                  </div>
                </div>

                <div className={styles.paymentNotice}>
                  <AlertCircle size={16} />
                  <p>
                    You have <strong>24 hours</strong> from submission to complete payment. Your spot will be released if payment isn&apos;t received in time.
                  </p>
                </div>

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

                <div className={styles.stepFooter}>
                  <button className={styles.btnGhost} onClick={() => setStep(1)}>Back</button>
                  <button
                    className={styles.btnPrimary}
                    disabled={!canStep3}
                    onClick={() => canStep3 && setSubmitted(true)}
                  >
                    Submit registration
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

/* ── Shared top bar ───────────────────────────────────────────── */
function TopBar({ id }: { id: string }) {
  return (
    <header className={styles.topBar}>
      <div className={styles.container}>
        <div className={styles.topBarInner}>
          <Link href="/" className={styles.brand}>
            <span className={styles.brandMark}>
              <svg viewBox="283 51 687 687" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="626.5" cy="394.5" r="343.5" fill="#EE7A4C" />
                <line x1="465" y1="258" x2="573" y2="258" stroke="white" strokeWidth="30" strokeLinecap="round" />
                <line x1="603" y1="320" x2="711" y2="320" stroke="white" strokeWidth="30" strokeLinecap="round" />
                <line x1="603" y1="471" x2="681" y2="471" stroke="white" strokeWidth="30" strokeLinecap="round" />
                <line x1="711" y1="449" x2="789" y2="449" stroke="white" strokeWidth="30" strokeLinecap="round" />
                <line x1="465" y1="531" x2="573" y2="531" stroke="white" strokeWidth="30" strokeLinecap="round" />
                <line x1="573" y1="259" x2="573" y2="380" stroke="white" strokeWidth="30" strokeLinecap="round" />
                <line x1="711" y1="320" x2="711" y2="449" stroke="white" strokeWidth="30" strokeLinecap="round" />
                <line x1="573" y1="410" x2="573" y2="531" stroke="white" strokeWidth="30" strokeLinecap="round" />
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
