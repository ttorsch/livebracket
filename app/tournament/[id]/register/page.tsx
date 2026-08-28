'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Check, AlertCircle } from 'lucide-react';
import { Badge, Button, Icon, Logo } from '@/components/livebracket-ds';
import styles from './page.module.css';
import { getTournamentDetail, type TournamentDetail, type DetailDivision } from '../../../../lib/data';
import { joinTeamName } from '../../../../lib/teamName';
import type { PresetKey } from '../../../../lib/registrationFields';
import { divisionRegistrationState } from '../../../../lib/tournamentLifecycle';
import { useSignInHref, saveScrollPosition, useRestoreScrollPosition } from '../../../../components/auth/useSignInHref';
import { useSession } from '../../../../components/auth/AuthProvider';
import RosterFields from '../../../../components/registration/RosterFields';
import AccountButton from '../../../../components/auth/AccountButton';

const STEPS = ['Division', 'Players', 'Review'];
const DONE = STEPS.length; // the confirmation panel sits one past the last step

/* The roster the redesign asks for: a name, an apparel size and two
   optional details per player, with one contact for the whole team.
   Everything else the organizer may have added to the division's form is
   not collected here — see the note above `submit`. */
interface PlayerAnswers {
  name: string;
  shirtSize: string;
  skill: string;
  nationality: string;
  club: string;
  userId?: string | null;
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

const emptyPlayer = (size: string): PlayerAnswers => ({ name: '', shirtSize: size, skill: '', nationality: '', club: '', userId: null });

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
  /* Signed in, the form already knows who is filling it in. The API reads
   * the session itself and links the team there — this only saves the
   * typing, so it stays an ordinary editable default: someone registering
   * a team on a friend's behalf can overwrite it. */
  const session = useSession();
  const [players, setPlayers] = useState<PlayerAnswers[]>([]);
  const [rules, setRules] = useState(false);
  const [pdpa, setPdpa] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);

  /* Only fills a field the visitor has not touched, and only once their
   * session is known — a late-arriving session must never overwrite an
   * address they already typed.
   *
   * Adjusted during render rather than in an effect, so the prefilled
   * address is there on the first paint instead of appearing a frame
   * later in an input the visitor may already be typing into. */
  const [seenSessionEmail, setSeenSessionEmail] = useState<string | null>(null);
  if (session.email && seenSessionEmail !== session.email) {
    setSeenSessionEmail(session.email);
    setContact(c => (c.email ? c : { ...c, email: session.email! }));
  }

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

  /* Each division brings its own roster size, so picking one starts the
     roster over rather than carrying rows the new division has no seat for. */
  const chooseDivision = (div: DetailDivision) => {
    const size = apparelSizes(div);
    const initial = size.includes('M') ? 'M' : size[0];
    setDivisionId(div.id);
    setPlayers(
      Array.from({ length: div.rosterSize }, (_, i) => {
        const player = emptyPlayer(initial);
        // Player 1 is whoever is filling the form in, when we know them.
        return i === 0 && session.signedIn
          ? { ...player, name: session.name || '', userId: session.userId }
          : player;
      }),
    );
  };

  const updatePlayer = (i: number, patch: Partial<PlayerAnswers>) => {
    setPlayers(prev => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  };


  const teamName = joinTeamName(players.map(p => p.name));

  /* A preset only blocks the step when the division actually asked for it
   * — isPresetRequired is false for a question that is not on the form at
   * all, so an absent preset can never hold the roster hostage. */
  const natRequired = isPresetRequired(selectedDiv, 'nationality');
  const clubRequired = isPresetRequired(selectedDiv, 'hometown');
  const skillRequired = isPresetRequired(selectedDiv, 'skill');

  const canStep1 = !!selectedDiv;
  const canStep2 =
    players.length > 0 &&
    !!contact.email.trim() &&
    !!contact.phone.trim() &&
    players.every(p =>
      p.name.trim() &&
      (!natRequired || p.nationality.trim()) &&
      (!clubRequired || p.club.trim()) &&
      (!skillRequired || p.skill.trim()));
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
    const skillKey = customKey(selectedDiv, 'skill', 'skill');
    try {
      const res = await fetch(`/api/tournaments/${slug}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          divisionId: selectedDiv.id,
          players: players.map((p, idx) => ({
            name: p.name.trim(),
            userId: p.userId ?? (idx === 0 && session.signedIn ? session.userId : null),
            email: contact.email.trim(),
            phone: contact.phone.trim(),
            shirtSize: p.shirtSize,
            custom: {
              ...(p.nationality.trim() ? { [natKey]: p.nationality.trim() } : {}),
              ...(p.club.trim() ? { [clubKey]: p.club.trim() } : {}),
              ...(p.skill.trim() ? { [skillKey]: p.skill.trim() } : {}),
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
    '',
    '',
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
                </div>
              </div>

              <RosterFields
                players={players}
                onPlayerChange={updatePlayer}
                contact={contact}
                onContactChange={patch => setContact(c => ({ ...c, ...patch }))}
                fields={selectedDiv.regFields}
                required={{ name: true, contact: true, nationality: natRequired, club: clubRequired }}
                /* The search panel explains itself when signed out rather
                   than the control disappearing. */
                signedIn={session.signedIn}
              />

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
                    <div className={`${styles.reviewRow} ${styles.reviewRowContact}`}>
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
    /* The registration hero deliberately does not carry the tournament's
       cover photo. A busy action shot behind a form competes with the
       thing the page is for — the coral-into-ink wash keeps the white
       hero type legible and the eye on the steps below. The event page
       is still where the photo belongs. */
    <div className={`${styles.hero} ${styles.heroFallback}`}>
      <div className={styles.heroOverlay} aria-hidden="true" />
      <HeroBar slug={slug} />

      <div className={styles.heroContent}>
        <BackToEvent slug={slug} className={styles.backPillLead} />

        <div className={styles.heroTags}>
          <Badge>Registration open</Badge>
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

/* The way back. Points at the event being registered for, not the
   events list — the arrow says "back", and losing the return path
   mid-registration is the worse trade. Rendered twice: narrow screens
   show the top-bar copy, alongside the wordmark and the account
   control; wide ones show the copy leading the hero column, where its
   left edge lines up with the status badge and title. Two elements
   rather than one moved by CSS, because they sit in different
   containers. */
function BackToEvent({ slug, className }: { slug: string; className: string }) {
  return (
    <Link href={`/tournament/${slug}`} className={`${styles.backPill} ${className}`}>
      <span className={styles.backPillIcon}>
        <Icon name="arrowRight" size={16} />
      </span>
      Events
    </Link>
  );
}

/* ── Top bar ──────────────────────────────────────────────────────
   Overlaid on the photo from 768px up and sitting on sand below it —
   the wordmark colour follows via --lb-logo-ink. */
function HeroBar({ slug }: { slug: string }) {
  const signInHref = useSignInHref();
  const router = useRouter();
  const { signedIn } = useSession();
  return (
    <div className={styles.heroBar}>
      <Link href="/" className={styles.heroBrand} aria-label="Live Bracket home">
        <Logo variant="lockup" size={30} color="var(--lb-logo-ink)" />
      </Link>

      <BackToEvent slug={slug} className={styles.backPillBar} />

      {/* Narrow screens have no room for the full lockup, but going home
          should not disappear with it — the wordmark alone sits beside
          the sign-in control, matching the event page's narrow header. A
          separate element rather than a prop swap because `variant` is
          not something CSS can switch, and both being in the DOM means
          no wrong-logo flash on first paint. */}
      <Link href="/" className={styles.heroBrandWord} aria-label="Live Bracket home">
        <Logo variant="wordmark" size={25} color="var(--lb-logo-ink)" />
      </Link>

      <div className={styles.heroNavActions}>
        {signedIn ? (
          <AccountButton onNavigate={() => saveScrollPosition()} />
        ) : (
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
        )}
      </div>
    </div>
  );
}

/* ── Page chrome for the load / empty states ──────────────────── */
function Shell({ slug, children }: { slug: string; children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <div className={`${styles.hero} ${styles.heroFallback}`}>
        <div className={styles.heroOverlay} aria-hidden="true" />
        <HeroBar slug={slug} />
        <div className={styles.heroContent}>
          <BackToEvent slug={slug} className={styles.backPillLead} />
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
