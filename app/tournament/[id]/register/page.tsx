'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Check, AlertCircle } from 'lucide-react';
import { Badge, Button, Icon, Logo, SegmentedControl } from '@/components/livebracket-ds';
import styles from './page.module.css';
import { getTournamentDetail, type TournamentDetail, type DetailDivision } from '../../../../lib/data';
import { joinTeamName } from '../../../../lib/teamName';
import type { PresetKey } from '../../../../lib/registrationFields';
import { divisionRegistrationState } from '../../../../lib/tournamentLifecycle';
import { useSignInHref, saveScrollPosition, useRestoreScrollPosition } from '../../../../components/auth/useSignInHref';

const STEPS = ['Division', 'Players', 'Review'];
const DONE = STEPS.length; // the confirmation panel sits one past the last step

/* The roster the redesign asks for: a name, an apparel size and two
   optional details per player, with one contact for the whole team.
   Everything else the organizer may have added to the division's form is
   not collected here — see the note above `submit`. */
interface PlayerAnswers {
  name: string;
  shirtSize: string;
  nationality: string;
  club: string;
}

const DEFAULT_SIZES = ['S', 'M', 'L', 'XL'];

/* Apparel sizes come from the division's own question when it has one, so a
   division offering XS–XXL isn't quietly forced onto the default four. */
function apparelSizes(div: DetailDivision | undefined): string[] {
  const field = div?.regFields.find(f => f.preset === 'apparel');
  return field?.options?.length ? field.options : DEFAULT_SIZES;
}

/* Nationality and club land in the player's custom_fields bag, keyed by the
   id of the division's matching question so the answer reads back on the
   organizer's side. A division that never added the question still stores
   the answer under a stable key. */
function customKey(div: DetailDivision | undefined, preset: PresetKey, fallback: string): string {
  return div?.regFields.find(f => f.preset === preset)?.id ?? fallback;
}

function isPresetRequired(div: DetailDivision | undefined, preset: PresetKey): boolean {
  return div?.regFields.find(f => f.preset === preset)?.required ?? false;
}

const emptyPlayer = (size: string): PlayerAnswers => ({ name: '', shirtSize: size, nationality: '', club: '' });

/* "Sep 26, 2026" from a stored 'YYYY-MM-DD'. Read in UTC to match how the
   rest of the app renders dates — a browser west of Greenwich would
   otherwise show the deadline a day early. */
function formatDeadline(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
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
  const router = useRouter();
  const slug = String(params.id);

  const [tournament, setTournament] = useState<TournamentDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useRestoreScrollPosition(!loading && Boolean(tournament));

  const [step, setStep] = useState(0);
  const [divisionId, setDivisionId] = useState('');
  const [contact, setContact] = useState({ email: '', phone: '' });
  const [players, setPlayers] = useState<PlayerAnswers[]>([]);
  const [rules, setRules] = useState(false);
  const [pdpa, setPdpa] = useState(false);
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
  const sizes = apparelSizes(selectedDiv);

  /* Each division brings its own roster size, so picking one starts the
     roster over rather than carrying rows the new division has no seat for. */
  const chooseDivision = (div: DetailDivision) => {
    const size = apparelSizes(div);
    const initial = size.includes('M') ? 'M' : size[0];
    setDivisionId(div.id);
    setPlayers(Array.from({ length: div.rosterSize }, () => emptyPlayer(initial)));
  };

  const updatePlayer = (i: number, patch: Partial<PlayerAnswers>) => {
    setPlayers(prev => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  };

  const teamName = joinTeamName(players.map(p => p.name));

  const natRequired = isPresetRequired(selectedDiv, 'nationality');
  const clubRequired = isPresetRequired(selectedDiv, 'hometown');

  const canStep1 = !!selectedDiv;
  const canStep2 =
    players.length > 0 &&
    !!contact.email.trim() &&
    !!contact.phone.trim() &&
    players.every(p =>
      p.name.trim() &&
      (!natRequired || p.nationality.trim()) &&
      (!clubRequired || p.club.trim()));
  const canStep3 = rules && pdpa;

  /* The one contact goes onto every player row: the division's base form
     asks each player for a phone and an email, and the API enforces that
     independently of this page. */
  const submit = async () => {
    if (!selectedDiv || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const natKey = customKey(selectedDiv, 'nationality', 'nationality');
    const clubKey = customKey(selectedDiv, 'hometown', 'hometown');
    try {
      const res = await fetch(`/api/tournaments/${slug}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          divisionId: selectedDiv.id,
          players: players.map(p => ({
            name: p.name.trim(),
            email: contact.email.trim(),
            phone: contact.phone.trim(),
            shirtSize: p.shirtSize,
            custom: {
              ...(p.nationality.trim() ? { [natKey]: p.nationality.trim() } : {}),
              ...(p.club.trim() ? { [clubKey]: p.club.trim() } : {}),
            },
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Registration failed');
      setResult(data as SubmitResult);
      setStep(DONE);
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
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <div className={styles.panelHeadText}>
              <h2 className={styles.stepTitle}>Choose a division</h2>
              <p className={styles.stepSub}>Loading this event&apos;s divisions…</p>
            </div>
          </div>
          <div className={styles.divisionGrid}>
            <div className={styles.skeletonRow} />
            <div className={styles.skeletonRow} />
          </div>
        </div>
      </Shell>
    );
  }

  if (loadError || !tournament) {
    return (
      <Shell slug={slug}>
        <StatePanel
          title="This event isn’t available"
          body={loadError ?? 'We couldn’t find a tournament at this address.'}
          actions={<Link href="/"><Button variant="primary">Browse events</Button></Link>}
        />
      </Shell>
    );
  }

  if (tournament.cancelled) {
    return (
      <Shell slug={slug}>
        <StatePanel
          title={`${tournament.title} has been cancelled`}
          body="This event is no longer taking registrations."
          actions={<Link href={`/tournament/${slug}`}><Button variant="primary">Back to tournament</Button></Link>}
        />
      </Shell>
    );
  }

  if (openDivisions.length === 0) {
    return (
      <Shell slug={slug}>
        <StatePanel
          title="Registration is closed"
          body={`No division at ${tournament.title} is taking teams right now.`}
          actions={<Link href={`/tournament/${slug}`}><Button variant="primary">Back to tournament</Button></Link>}
        />
      </Shell>
    );
  }

  /* Most events close every division on the same day. When they do the
     date is a single stat beside the step title; when they don't, each
     card carries its own. */
  const closeDates = new Set(openDivisions.map(d => d.registrationCloses));
  const sharedClose = closeDates.size === 1 ? openDivisions[0].registrationCloses : '';

  /* ── Footer copy, one row per step ────────────────────────────── */
  const closesOn = selectedDiv?.registrationCloses ? formatDeadline(selectedDiv.registrationCloses) : '';
  const waitlisted = result?.status === 'waitlist';

  const hints = [
    selectedDiv
      ? `${selectedDiv.label} · ${selectedDiv.registrationFee.toLocaleString()} THB per team`
      : 'Pick a division to continue',
    'Email, phone and every player name are required',
    canStep3 ? 'Ready to submit' : 'Tick both agreements to submit',
    waitlisted
      ? 'You’re on the waitlist — nothing to pay yet'
      : `Confirmation sent${closesOn ? ` · Entries close ${closesOn}` : ''}`,
  ];

  const goBack = () => {
    if (step === 0) router.push(`/tournament/${slug}`);
    else setStep(step - 1);
  };

  const stepLabel = step === DONE ? 'Registration complete' : `Step ${step + 1} of ${STEPS.length}`;

  /* ── Wizard ───────────────────────────────────────────────────── */
  return (
    <div className={styles.page}>
      <Hero slug={slug} tournament={tournament} stepLabel={stepLabel} />

      <div className={styles.cardWrap}>
        <div className={styles.card}>

          {/* ── Stepper ───────────────────────────────────────── */}
          <div className={styles.stepper}>
            {STEPS.map((label, i) => {
              const done = step > i;
              const active = step === i;
              return (
                <div key={label} className={styles.stepItem}>
                  <button
                    type="button"
                    disabled={!done}
                    onClick={() => done && setStep(i)}
                    className={`${styles.stepHead} ${done ? styles.stepHeadDone : ''}`}
                  >
                    <span className={`${styles.stepCircle} ${done ? styles.stepCircleDone : ''} ${active ? styles.stepCircleActive : ''}`}>
                      {done ? <Check size={14} strokeWidth={3} /> : i + 1}
                    </span>
                    <span className={`${styles.stepLabel} ${done ? styles.stepLabelSeen : ''} ${active ? styles.stepLabelActive : ''}`}>
                      {label}
                    </span>
                  </button>
                  <span className={`${styles.stepLine} ${done ? styles.stepLineDone : ''}`} />
                </div>
              );
            })}
          </div>

          {/* ── Step 1: Division ──────────────────────────────── */}
          {step === 0 && (
            <div className={styles.panel}>
              <div className={styles.panelHead}>
                <div className={styles.panelHeadText}>
                  <h2 className={styles.stepTitle}>Choose a division</h2>
                  <p className={styles.stepSub}>
                    Fees are per team and paid at check-in. You can switch divisions until the entry deadline.
                  </p>
                </div>
                {sharedClose && (
                  <div className={styles.deadline}>
                    <span className={styles.deadlineLabel}>Entries close</span>
                    <span className={styles.deadlineValue}>{formatDeadline(sharedClose)}</span>
                  </div>
                )}
              </div>

              <div className={styles.divisionGrid}>
                {openDivisions.map(div => {
                  const full = div.filled >= div.teams;
                  const waitlistFull = full && div.waitlistCap <= 0;
                  const left = Math.max(0, div.teams - div.filled);
                  const pct = Math.min(100, (div.filled / Math.max(1, div.teams)) * 100);
                  const selected = divisionId === div.id;
                  return (
                    <button
                      key={div.id}
                      type="button"
                      disabled={waitlistFull}
                      aria-pressed={selected}
                      className={`${styles.divCard} ${waitlistFull ? styles.divCardFull : ''}`}
                      onClick={() => chooseDivision(div)}
                    >
                      <span className={`${styles.divRing} ${selected ? styles.divRingOn : ''}`} aria-hidden="true" />
                      <span className={styles.divTop}>
                        <span className={styles.divIdentity}>
                          <span className={styles.divNameRow}>
                            <span className={styles.divName}>{div.label}</span>
                            {waitlistFull
                              ? <Badge variant="status">Full</Badge>
                              : full && <Badge variant="highlight">Waitlist</Badge>}
                          </span>
                          <span className={styles.divFee}>
                            <span className={styles.divFeeValue}>{div.registrationFee.toLocaleString()}</span>
                            <span className={styles.divFeeCurrency}>THB</span>
                          </span>
                        </span>
                        <span className={`${styles.divCheck} ${selected ? styles.divCheckOn : ''}`} aria-hidden="true">
                          <Check size={14} strokeWidth={3} />
                        </span>
                      </span>

                      <span className={styles.divProgressWrap}>
                        <span className={styles.divTrack}>
                          <span className={styles.divBar} style={{ width: `${pct}%` }} />
                        </span>
                        <span className={styles.divMeta}>
                          <span>{div.filled}/{div.teams} teams registered</span>
                          <span className={left <= 2 && !full ? styles.divLeftTight : styles.divLeft}>
                            {full ? 'No spots left' : `${left} spot${left === 1 ? '' : 's'} left`}
                          </span>
                        </span>
                        {!sharedClose && (
                          <span className={styles.divDeadline}>
                            {div.registrationCloses
                              ? `Entries close ${formatDeadline(div.registrationCloses)}`
                              : 'No entry deadline'}
                          </span>
                        )}
                      </span>

                      {full && !waitlistFull && (
                        <span className={styles.divNote}>This division is full — you’ll join the waitlist.</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Step 2: Players ───────────────────────────────── */}
          {step === 1 && selectedDiv && (
            <div className={`${styles.panel} ${styles.panelRoster}`}>
              <div className={styles.panelHead}>
                <div className={styles.panelHeadText}>
                  <h2 className={styles.stepTitle}>Enter players</h2>
                  <p className={styles.stepSub}>
                    {selectedDiv.label} is a {selectedDiv.formatTypeOnSand} division — {players.length} player
                    {players.length === 1 ? '' : 's'} on the roster. Names are required.
                  </p>
                </div>
              </div>

              <div className={styles.fieldSet}>
                <span className={styles.sectionLabel}>Team contact</span>
                <div className={styles.contactGrid}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Email <span className={styles.req}>*</span></span>
                    <input
                      className={styles.input}
                      type="email"
                      autoComplete="email"
                      placeholder="captain@email.com"
                      value={contact.email}
                      onChange={e => setContact(c => ({ ...c, email: e.target.value }))}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Phone / WhatsApp <span className={styles.req}>*</span></span>
                    <input
                      className={styles.input}
                      type="tel"
                      autoComplete="tel"
                      placeholder="+66 __ ___ ____"
                      value={contact.phone}
                      onChange={e => setContact(c => ({ ...c, phone: e.target.value }))}
                    />
                  </label>
                </div>
              </div>

              <div className={styles.playerGrid}>
                {players.map((player, i) => (
                  <div key={i} className={styles.playerCard}>
                    <div className={styles.playerHead}>
                      <span className={styles.playerNum}>{i + 1}</span>
                      <span className={styles.playerName}>Player {i + 1}</span>
                    </div>

                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Full name <span className={styles.req}>*</span></span>
                      <input
                        className={styles.input}
                        placeholder={i === 0 ? 'e.g. Anna Sirisai' : 'e.g. Mai Chaiyo'}
                        value={player.name}
                        onChange={e => updatePlayer(i, { name: e.target.value })}
                      />
                    </label>

                    <div className={styles.playerExtras}>
                      <div className={styles.field}>
                        <span className={styles.fieldLabel}>Apparel size</span>
                        <SegmentedControl
                          options={sizes}
                          value={player.shirtSize}
                          onChange={val => updatePlayer(i, { shirtSize: val })}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: `repeat(${sizes.length}, minmax(0, 1fr))`,
                            width: '100%',
                          }}
                        />
                      </div>
                      <div className={styles.playerExtraPair}>
                        <label className={styles.field}>
                          <span className={styles.fieldLabel}>
                            Nationality {natRequired && <span className={styles.req}>*</span>}
                          </span>
                          <input
                            className={styles.input}
                            placeholder="Thailand"
                            value={player.nationality}
                            onChange={e => updatePlayer(i, { nationality: e.target.value })}
                          />
                        </label>
                        <label className={styles.field}>
                          <span className={styles.fieldLabel}>
                            Club / hometown {clubRequired && <span className={styles.req}>*</span>}
                          </span>
                          <input
                            className={styles.input}
                            placeholder="KLV"
                            value={player.club}
                            onChange={e => updatePlayer(i, { club: e.target.value })}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Teams are named after their players everywhere in Live
                  Bracket — the bracket, the schedule, the score screen —
                  so the name is derived here rather than typed. */}
              <div className={styles.teamNamePreview}>
                <span className={styles.teamNamePreviewLabel}>Your team will appear as</span>
                <span className={styles.teamNamePreviewValue}>{teamName || '—'}</span>
              </div>
            </div>
          )}

          {/* ── Step 3: Review ────────────────────────────────── */}
          {step === 2 && selectedDiv && (
            <div className={styles.panel}>
              <div className={styles.panelHead}>
                <div className={styles.panelHeadText}>
                  <h2 className={styles.stepTitle}>Review and confirm</h2>
                  <p className={styles.stepSub}>The organizer sees exactly this. You can edit any step before submitting.</p>
                </div>
              </div>

              <div className={styles.reviewGrid}>
                <div className={styles.reviewTeam}>
                  <div className={styles.reviewTeamHead}>
                    <span className={styles.sectionLabel}>Team</span>
                    <button type="button" className={styles.editLink} onClick={() => setStep(1)}>Edit</button>
                  </div>
                  <div className={styles.reviewRows}>
                    {players.map((p, i) => (
                      <div key={i} className={styles.reviewRow}>
                        <span className={styles.reviewRowLabel}>Player {i + 1}</span>
                        <span className={styles.reviewRowValue}>
                          <span className={styles.reviewValue}>{p.name.trim() || `Player ${i + 1} — not set`}</span>
                          <span className={styles.reviewMeta}>
                            {[p.nationality.trim(), p.club.trim(), `Size ${p.shirtSize}`].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                      </div>
                    ))}
                    <div className={styles.reviewRow}>
                      <span className={styles.reviewRowLabel}>Contact</span>
                      <span className={styles.reviewRowValue}>
                        <span className={styles.reviewValue}>{contact.email.trim() || 'No email yet'}</span>
                        <span className={styles.reviewMeta}>{contact.phone.trim() || 'No phone given'}</span>
                      </span>
                    </div>
                  </div>
                </div>

                <div className={styles.reviewFee}>
                  <div className={styles.reviewFeeHead}>
                    <span className={styles.reviewFeeKicker}>Division</span>
                    <button type="button" className={styles.editLinkOnInk} onClick={() => setStep(0)}>Change</button>
                  </div>
                  <span className={styles.reviewFeeDivision}>{selectedDiv.label}</span>
                  <div className={styles.reviewFeeRule} />
                  <div className={styles.reviewFeeRow}>
                    <span className={styles.reviewFeeRowLabel}>Entry fee, per team</span>
                    <span className={styles.reviewFeeAmount}>
                      <span className={styles.reviewFeeValue}>{selectedDiv.registrationFee.toLocaleString()}</span>
                      <span className={styles.reviewFeeCurrency}>THB</span>
                    </span>
                  </div>
                  {selectedDiv.filled >= selectedDiv.teams ? (
                    <span className={styles.waitlistNote}>
                      This division is full. You&apos;ll join the waitlist and pay nothing unless a spot opens.
                    </span>
                  ) : (
                    <span className={styles.reviewFeeNote}>
                      Your spot is held for 24 hours from submission. Pay the organizer to confirm it.
                    </span>
                  )}
                </div>
              </div>

              {selectedDiv.rules && <div className={styles.rulesBlock}>{selectedDiv.rules}</div>}

              <div className={styles.consentList}>
                <label className={styles.consentRow}>
                  <input
                    type="checkbox"
                    className={styles.consentInput}
                    checked={rules}
                    onChange={e => setRules(e.target.checked)}
                  />
                  <span className={`${styles.consentBox} ${rules ? styles.consentBoxOn : ''}`} aria-hidden="true">
                    {rules && <Check size={14} strokeWidth={3} />}
                  </span>
                  <span className={styles.consentText}>
                    Both players agree to the tournament rules and the safety briefing, and confirm they can play on
                    every day of the event.
                  </span>
                </label>
                <label className={styles.consentRow}>
                  <input
                    type="checkbox"
                    className={styles.consentInput}
                    checked={pdpa}
                    onChange={e => setPdpa(e.target.checked)}
                  />
                  <span className={`${styles.consentBox} ${pdpa ? styles.consentBoxOn : ''}`} aria-hidden="true">
                    {pdpa && <Check size={14} strokeWidth={3} />}
                  </span>
                  <span className={styles.consentText}>
                    I consent to the collection and use of my personal data for event management purposes in
                    accordance with Thailand&apos;s PDPA.
                  </span>
                </label>
              </div>

              {submitError && (
                <div className={styles.formError}>
                  <AlertCircle size={16} className={styles.formErrorIcon} />
                  <span>{submitError}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Done ──────────────────────────────────────────── */}
          {step === DONE && result && (
            <div className={styles.done}>
              <span className={styles.doneIcon}>
                <Check size={26} strokeWidth={3} />
              </span>
              <h2 className={styles.doneTitle}>
                {waitlisted ? 'You’re on the waitlist' : 'You’re on the draw'}
              </h2>
              <p className={styles.doneBody}>
                {waitlisted ? (
                  <>
                    <strong>{result.teamName}</strong> is on the waitlist for <strong>{result.divisionName}</strong>.
                    You&apos;ll be moved up if a team drops out — no payment is due yet.
                  </>
                ) : (
                  <>
                    <strong>{result.teamName}</strong> is registered for <strong>{result.divisionName}</strong>. The
                    live bracket link is emailed to {contact.email.trim()}.
                  </>
                )}
              </p>
              {!waitlisted && (
                <span className={styles.doneNote}>
                  <AlertCircle size={14} />
                  {result.fee.toLocaleString()} THB due within 24 hours — unpaid entries are released automatically.
                </span>
              )}
              {selectedDiv?.confirmationMessage && (
                <div className={`${styles.rulesBlock} ${styles.doneMessage}`}>{selectedDiv.confirmationMessage}</div>
              )}
            </div>
          )}

          {/* ── Footer ────────────────────────────────────────── */}
          <div className={styles.footer}>
            <span className={styles.footerHint}>{hints[step]}</span>
            <div className={styles.footerActions}>
              {step === DONE ? (
                <>
                  <Button variant="general" fullWidth onClick={() => router.push('/')}>Browse events</Button>
                  <Button variant="primary" fullWidth onClick={() => router.push(`/tournament/${slug}`)}>
                    Back to event
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="general" fullWidth disabled={submitting} onClick={goBack}>
                    {step === 0 ? 'Cancel' : 'Back'}
                  </Button>
                  {step === 0 && (
                    <Button variant="primary" fullWidth disabled={!canStep1} onClick={() => setStep(1)}>
                      Continue
                    </Button>
                  )}
                  {step === 1 && (
                    <Button variant="primary" fullWidth disabled={!canStep2} onClick={() => setStep(2)}>
                      Review registration
                    </Button>
                  )}
                  {step === 2 && (
                    <Button variant="primary" fullWidth loading={submitting} disabled={!canStep3} onClick={submit}>
                      Submit registration
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

/* ── Hero ─────────────────────────────────────────────────────────
   The tournament's cover photo under a gradient that lands on the app's
   sand, so the card below can ride up into it. */
function Hero({ slug, tournament, stepLabel }: {
  slug: string;
  tournament: TournamentDetail;
  stepLabel: string;
}) {
  const rosterSizes = Array.from(new Set(tournament.divisions.map(d => d.rosterSize))).sort((a, b) => a - b);
  const playersLabel = rosterSizes.length === 1
    ? `${rosterSizes[0]} players per team`
    : `${rosterSizes[0]}–${rosterSizes[rosterSizes.length - 1]} players per team`;

  return (
    <div
      className={`${styles.hero} ${tournament.imageUrl ? '' : styles.heroFallback}`}
      style={tournament.imageUrl ? { backgroundImage: `url(${tournament.imageUrl})` } : undefined}
    >
      <div className={styles.heroOverlay} aria-hidden="true" />
      <HeroBar />

      <div className={styles.heroContent}>
        <Link href={`/tournament/${slug}`} className={styles.backPill}>
          <span className={styles.backPillIcon}>
            <Icon name="arrowRight" size={16} />
          </span>
          Back to event
        </Link>

        <div className={styles.heroTags}>
          <Badge>Registration open</Badge>
          <span className={styles.heroStep}>{stepLabel}</span>
        </div>

        <h1 className={styles.heroTitle}>{tournament.title}</h1>

        <div className={styles.heroMeta}>
          <span className={styles.heroMetaItem}>
            <Icon name="location" size={17} />
            {tournament.location}
          </span>
          <span className={styles.heroMetaItem}>
            <Icon name="calendar" size={17} />
            {tournament.date}
          </span>
          {rosterSizes.length > 0 && (
            <span className={styles.heroMetaItem}>
              <Icon name="users" size={17} />
              {playersLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Top bar ──────────────────────────────────────────────────────
   Overlaid on the photo from 768px up and sitting on sand below it —
   the wordmark colour follows via --lb-logo-ink. */
function HeroBar() {
  const signInHref = useSignInHref();
  const router = useRouter();
  return (
    <div className={styles.heroBar}>
      <Link href="/" className={styles.heroBrand} aria-label="Live Bracket home">
        <Logo variant="lockup" size={30} color="var(--lb-logo-ink)" />
      </Link>
      <Button
        variant="general"
        size="small"
        onClick={() => {
          saveScrollPosition();
          router.push(signInHref);
        }}
      >
        Log in
      </Button>
    </div>
  );
}

/* ── Page chrome for the load / empty states ──────────────────── */
function Shell({ slug, children }: { slug: string; children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <div className={`${styles.hero} ${styles.heroFallback}`}>
        <div className={styles.heroOverlay} aria-hidden="true" />
        <HeroBar />
        <div className={styles.heroContent}>
          <Link href={`/tournament/${slug}`} className={styles.backPill}>
            <span className={styles.backPillIcon}>
              <Icon name="arrowRight" size={16} />
            </span>
            Back to event
          </Link>
          <h1 className={styles.heroTitle}>Register a team</h1>
        </div>
      </div>
      <div className={styles.cardWrap}>
        <div className={styles.card}>{children}</div>
      </div>
    </div>
  );
}

function StatePanel({ title, body, actions }: { title: string; body: string; actions: React.ReactNode }) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <div className={styles.panelHeadText}>
          <h2 className={styles.stepTitle}>{title}</h2>
          <p className={styles.stepSub}>{body}</p>
        </div>
      </div>
      <div className={styles.stateActions}>{actions}</div>
    </div>
  );
}
