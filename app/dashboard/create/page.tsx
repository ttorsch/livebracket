'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ChevronRight, Plus, Trash2 } from 'lucide-react';
import styles from './page.module.css';

const STEPS = ['Info', 'Format', 'Divisions', 'Courts & Fees', 'Review'];
const FORMATS = [
  { id: 'single', label: 'Single Elimination', desc: 'Classic knockout. One loss and you\'re out.' },
  { id: 'double', label: 'Double Elimination', desc: 'One loss sends you to the losers bracket. Lose twice and you\'re out.' },
  { id: 'round-robin', label: 'Round Robin', desc: 'Everyone plays everyone. Top teams advance.' },
  { id: 'hybrid', label: 'Hybrid (Pool + Bracket)', desc: 'Pool play to determine seeds, then elimination bracket.' },
];

interface Division { name: string; maxTeams: number; minPlayers: number }
interface Court { name: string }

export default function CreateTournament() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  // Step 0: Info
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [description, setDescription] = useState('');

  // Step 1: Format
  const [format, setFormat] = useState('');

  // Step 2: Divisions
  const [divisions, setDivisions] = useState<Division[]>([
    { name: "Men's Open", maxTeams: 8, minPlayers: 2 },
  ]);

  // Step 3: Courts & fees
  const [courts, setCourts] = useState<Court[]>([{ name: 'Court 1' }]);
  const [feePerTeam, setFeePerTeam] = useState('');
  const [currency, setCurrency] = useState('THB');
  const [paymentWindow, setPaymentWindow] = useState('24');

  // Step 4: Review + submit
  const [submitted, setSubmitted] = useState(false);

  const canStep0 = !!title.trim() && !!location.trim() && !!startDate;
  const canStep1 = !!format;
  const canStep2 = divisions.length > 0 && divisions.every(d => d.name.trim());
  const canStep3 = courts.length > 0 && !!feePerTeam;

  const addDivision = () => setDivisions(prev => [...prev, { name: '', maxTeams: 8, minPlayers: 2 }]);
  const removeDivision = (i: number) => setDivisions(prev => prev.filter((_, idx) => idx !== i));
  const updateDivision = (i: number, key: keyof Division, val: string | number) =>
    setDivisions(prev => prev.map((d, idx) => idx === i ? { ...d, [key]: val } : d));

  const addCourt = () => setCourts(prev => [...prev, { name: `Court ${prev.length + 1}` }]);
  const removeCourt = (i: number) => setCourts(prev => prev.filter((_, idx) => idx !== i));
  const updateCourt = (i: number, val: string) =>
    setCourts(prev => prev.map((c, idx) => idx === i ? { name: val } : c));

  const canAdvance = [canStep0, canStep1, canStep2, canStep3][step] ?? true;

  if (submitted) {
    return (
      <div className={styles.page}>
        <TopBar />
        <div className={styles.successWrap}>
          <div className={styles.successCard}
            style={{ backdropFilter: 'blur(18px) saturate(150%)', WebkitBackdropFilter: 'blur(18px) saturate(150%)' }}
          >
            <div className={styles.successIcon}><Check size={32} strokeWidth={3} /></div>
            <h2 className={styles.successTitle}>Tournament created!</h2>
            <p className={styles.successSub}>
              <strong>{title}</strong> has been created. Share the registration link to start collecting teams.
            </p>
            <div className={styles.successActions}>
              <Link href="/dashboard" className={styles.btnPrimary}>Go to dashboard</Link>
              <Link href="/" className={styles.btnGhost}>Browse events</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <TopBar />

      {/* ── Stepper ───────────────────────────────────────────── */}
      <div className={styles.stepper}>
        <div className={styles.container}>
          <div className={styles.stepperInner}>
            {STEPS.map((label, i) => (
              <div key={label} className={styles.stepWrap}>
                <div className={`${styles.stepCircle} ${i < step ? styles.stepDone : ''} ${i === step ? styles.stepActive : ''}`}>
                  {i < step ? <Check size={13} strokeWidth={3} /> : i + 1}
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

            {/* ── Step 0: Info ──────────────────────────────────── */}
            {step === 0 && (
              <div>
                <h2 className={styles.stepTitle}>Tournament info</h2>
                <p className={styles.stepSub}>Give your event a name, location, and dates.</p>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Tournament name *</label>
                  <input className={styles.input} type="text" placeholder="e.g. Bang Niang Beach Classic 2025" value={title} onChange={e => setTitle(e.target.value)} />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Location *</label>
                  <input className={styles.input} type="text" placeholder="e.g. Bang Niang Beach, Khao Lak" value={location} onChange={e => setLocation(e.target.value)} />
                </div>
                <div className={styles.twoCol}>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>Start date *</label>
                    <input className={styles.input} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>End date</label>
                    <input className={styles.input} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                  </div>
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Description</label>
                  <textarea className={styles.textarea} rows={3} placeholder="Optional — tell players what to expect..." value={description} onChange={e => setDescription(e.target.value)} />
                </div>
              </div>
            )}

            {/* ── Step 1: Format ────────────────────────────────── */}
            {step === 1 && (
              <div>
                <h2 className={styles.stepTitle}>Tournament format</h2>
                <p className={styles.stepSub}>Choose how matches are structured.</p>
                <div className={styles.formatGrid}>
                  {FORMATS.map(f => (
                    <button
                      key={f.id}
                      className={`${styles.formatCard} ${format === f.id ? styles.formatCardActive : ''}`}
                      onClick={() => setFormat(f.id)}
                    >
                      {format === f.id && <div className={styles.formatCheck}><Check size={13} strokeWidth={3} /></div>}
                      <p className={styles.formatLabel}>{f.label}</p>
                      <p className={styles.formatDesc}>{f.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Step 2: Divisions ─────────────────────────────── */}
            {step === 2 && (
              <div>
                <h2 className={styles.stepTitle}>Divisions</h2>
                <p className={styles.stepSub}>Add the divisions you want to run. Each can have different team limits.</p>
                <div className={styles.divisionList}>
                  {divisions.map((div, i) => (
                    <div key={i} className={styles.divRow}>
                      <div className={styles.divRowFields}>
                        <div className={styles.fieldGroup}>
                          <label className={styles.fieldLabel}>Division name *</label>
                          <input
                            className={styles.input}
                            type="text"
                            placeholder="e.g. Men's Open"
                            value={div.name}
                            onChange={e => updateDivision(i, 'name', e.target.value)}
                          />
                        </div>
                        <div className={styles.fieldGroup}>
                          <label className={styles.fieldLabel}>Max teams</label>
                          <input
                            className={styles.input}
                            type="number"
                            min={2}
                            max={64}
                            value={div.maxTeams}
                            onChange={e => updateDivision(i, 'maxTeams', parseInt(e.target.value) || 8)}
                          />
                        </div>
                      </div>
                      {divisions.length > 1 && (
                        <button className={styles.removeBtn} onClick={() => removeDivision(i)}>
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button className={styles.addBtn} onClick={addDivision}>
                  <Plus size={16} /> Add division
                </button>
              </div>
            )}

            {/* ── Step 3: Courts & Fees ─────────────────────────── */}
            {step === 3 && (
              <div>
                <h2 className={styles.stepTitle}>Courts &amp; fees</h2>
                <p className={styles.stepSub}>Set up your playing courts and the registration fee per team.</p>

                <h3 className={styles.subSection}>Courts</h3>
                <div className={styles.divisionList}>
                  {courts.map((c, i) => (
                    <div key={i} className={styles.divRow}>
                      <div className={styles.fieldGroup} style={{ flex: 1 }}>
                        <label className={styles.fieldLabel}>Court name</label>
                        <input
                          className={styles.input}
                          type="text"
                          placeholder={`Court ${i + 1}`}
                          value={c.name}
                          onChange={e => updateCourt(i, e.target.value)}
                        />
                      </div>
                      {courts.length > 1 && (
                        <button className={styles.removeBtn} onClick={() => removeCourt(i)}>
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button className={styles.addBtn} onClick={addCourt}>
                  <Plus size={16} /> Add court
                </button>

                <h3 className={styles.subSection} style={{ marginTop: 28 }}>Registration fee</h3>
                <div className={styles.twoCol}>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>Fee per team *</label>
                    <input className={styles.input} type="number" min={0} placeholder="e.g. 800" value={feePerTeam} onChange={e => setFeePerTeam(e.target.value)} />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>Currency</label>
                    <select className={styles.select} value={currency} onChange={e => setCurrency(e.target.value)}>
                      <option value="THB">THB</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Payment window (hours)</label>
                  <input className={styles.input} type="number" min={1} max={72} value={paymentWindow} onChange={e => setPaymentWindow(e.target.value)} />
                  <p className={styles.fieldHint}>Teams have this many hours to complete payment after registering. Unpaid spots are released automatically.</p>
                </div>
              </div>
            )}

            {/* ── Step 4: Review ────────────────────────────────── */}
            {step === 4 && (
              <div>
                <h2 className={styles.stepTitle}>Review &amp; publish</h2>
                <p className={styles.stepSub}>Check everything before publishing your tournament.</p>
                <div className={styles.reviewBlock}>
                  <ReviewRow label="Name" value={title} />
                  <ReviewRow label="Location" value={location} />
                  <ReviewRow label="Dates" value={`${startDate}${endDate ? ` → ${endDate}` : ''}`} />
                  <ReviewRow label="Format" value={FORMATS.find(f => f.id === format)?.label ?? ''} />
                  <ReviewRow label="Divisions" value={divisions.map(d => d.name).join(', ')} />
                  <ReviewRow label="Courts" value={courts.map(c => c.name).join(', ')} />
                  <ReviewRow label="Fee per team" value={`${feePerTeam} ${currency}`} />
                  <ReviewRow label="Payment window" value={`${paymentWindow} hours`} last />
                </div>
              </div>
            )}

            {/* ── Nav buttons ───────────────────────────────────── */}
            <div className={styles.stepFooter}>
              {step > 0 ? (
                <button className={styles.btnGhost} onClick={() => setStep(s => s - 1)}>Back</button>
              ) : (
                <Link href="/dashboard" className={styles.btnGhost}>Cancel</Link>
              )}
              {step < STEPS.length - 1 ? (
                <button
                  className={styles.btnPrimary}
                  disabled={!canAdvance}
                  onClick={() => canAdvance && setStep(s => s + 1)}
                >
                  Continue <ChevronRight size={16} />
                </button>
              ) : (
                <button
                  className={styles.btnPrimary}
                  onClick={() => setSubmitted(true)}
                >
                  Publish tournament
                </button>
              )}
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}

function ReviewRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`${styles.reviewRow} ${last ? styles.reviewRowLast : ''}`}>
      <span className={styles.reviewLabel}>{label}</span>
      <span className={styles.reviewValue}>{value}</span>
    </div>
  );
}

function TopBar() {
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
                <line x1="465" y1="531" x2="573" y2="531" stroke="white" strokeWidth="30" strokeLinecap="round" />
                <line x1="573" y1="259" x2="573" y2="380" stroke="white" strokeWidth="30" strokeLinecap="round" />
                <line x1="573" y1="410" x2="573" y2="531" stroke="white" strokeWidth="30" strokeLinecap="round" />
              </svg>
            </span>
            Live Bracket
          </Link>
          <Link href="/dashboard" className={styles.topBack}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M12 7H2m0 0l4 4M2 7l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Dashboard
          </Link>
        </div>
      </div>
    </header>
  );
}
