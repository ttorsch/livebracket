/* ── A tournament's lifecycle ─────────────────────────────────────
 *
 * Three independent things, deliberately not folded into one column:
 *
 *   phase        where the event is: draft → announced → open → closed
 *   archived_at  hidden from every list; only for events nobody committed to
 *   cancelled_at called off; stays visible so registered players find out
 *   deleted_at   gone, no restore UI — only for drafts nobody has seen yet
 *
 * Which retirement an organizer gets is decided by the phase, and that rule
 * lives here rather than in the dialog that renders it — the API has to
 * enforce the same thing, and a rule written twice is a rule that drifts.
 */

export const PHASE = {
  draft: 1,
  announced: 2,
  open: 3,
  closed: 4,
} as const;

export type Phase = (typeof PHASE)[keyof typeof PHASE];

export const PHASE_LABEL: Record<Phase, string> = {
  1: 'Draft',
  2: 'Announced',
  3: 'Registration open',
  4: 'Registration closed',
};

export function isPhase(v: unknown): v is Phase {
  return v === 1 || v === 2 || v === 3 || v === 4;
}

/* ── The status an organizer sets ─────────────────────────────────
 *
 * Only two, and they mean one thing: is this event visible to players?
 *
 *   Draft      nobody but the organizer sees it
 *   Announced  it is public
 *
 * Whether anyone can *register* is not a tournament-level switch. Each
 * division opens and closes on its own dates, and the tournament's
 * registration state is read back off those — see registrationState. An
 * organizer who has set a division's dates has already said everything
 * needed; making them also remember to flip a status is a second source of
 * truth that can disagree with the first.
 *
 * Phases 3 and 4 remain in the type because rows created before this
 * existed still carry them; they read as public and are offered as a
 * choice only so such a row can be normalised by saving the form.
 */
export function selectablePhases(from: Phase): Phase[] {
  const out: Phase[] = [PHASE.draft, PHASE.announced];
  if (!out.includes(from)) out.push(from);
  return out.sort((a, b) => a - b);
}

/** Is this tournament visible to players at all? */
export function isPublic(phase: Phase): boolean {
  return phase >= PHASE.announced;
}

/* ── Registration, derived ────────────────────────────────────────
 *
 * A division is open between its open date and the end of its close date.
 * An empty open date means "as soon as the tournament is public"; an empty
 * close date means it never closes on its own.
 */
export type RegistrationState = 'opens-soon' | 'open' | 'closed';

export interface DivisionWindow {
  /** datetime-local string, or '' for immediately */
  registrationOpens: string;
  /** 'YYYY-MM-DD', or '' for never */
  registrationCloses: string;
}

export function divisionRegistrationState(d: DivisionWindow, now: Date = new Date()): RegistrationState {
  // Closing wins over opening: a window whose dates were set the wrong way
  // round should read as shut, not as open forever.
  if (d.registrationCloses) {
    const [y, m, day] = d.registrationCloses.split('-').map(Number);
    if (y && m && day) {
      // Registration runs to the end of the close date, so compare against
      // the following midnight rather than the date itself.
      if (now.getTime() >= Date.UTC(y, m - 1, day + 1)) return 'closed';
    }
  }
  if (d.registrationOpens) {
    const opens = new Date(d.registrationOpens);
    if (!isNaN(opens.getTime()) && now < opens) return 'opens-soon';
  }
  return 'open';
}

/** The tournament's registration state, read off its divisions: open if any
 *  division is taking teams, otherwise opening soon if any still will, and
 *  closed once none do. Null when there is nothing to register for at all. */
export function registrationState(
  divisions: DivisionWindow[],
  now: Date = new Date(),
): RegistrationState | null {
  if (divisions.length === 0) return null;
  const states = divisions.map(d => divisionRegistrationState(d, now));
  if (states.includes('open')) return 'open';
  if (states.includes('opens-soon')) return 'opens-soon';
  return 'closed';
}

/** The earliest date any division opens, for "Opens 26 Sep" copy. */
export function nextOpening(divisions: DivisionWindow[], now: Date = new Date()): Date | null {
  const upcoming = divisions
    .filter(d => divisionRegistrationState(d, now) === 'opens-soon')
    .map(d => new Date(d.registrationOpens))
    .filter(d => !isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  return upcoming[0] ?? null;
}

/** Registration closes a week before the event unless the organizer says
 *  otherwise. Returns a 'YYYY-MM-DD' string, or '' if the start is unusable. */
export function registrationCloseDefault(tournamentStart: string | null | undefined): string {
  if (!tournamentStart) return '';
  const [y, m, d] = tournamentStart.split('-').map(Number);
  if (!y || !m || !d) return '';
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - 7);
  return t.toISOString().slice(0, 10);
}

/** Nothing has been promised to anyone in draft or announced, so those can be
 *  archived away. Once registration has opened, people have committed — the
 *  honest action is to cancel, which stays on the public page. */
export type Retirement = 'archive' | 'cancel';

export function retirementFor(phase: Phase): Retirement {
  return phase === PHASE.draft || phase === PHASE.announced ? 'archive' : 'cancel';
}

export const RETIREMENT_COPY: Record<Retirement, { label: string; blurb: string; confirmHint: string }> = {
  archive: {
    label: 'Archive tournament',
    blurb:
      'Hides it from your dashboard and from the public site. Nothing is deleted — divisions, teams and matches are kept, and it can be brought back.',
    confirmHint: 'This hides the tournament everywhere. Type its name to confirm.',
  },
  cancel: {
    label: 'Cancel tournament',
    blurb:
      'Marks it CANCELLED. It stays on the public page so registered teams find out, and its bracket and results are kept.',
    confirmHint: 'Registered teams will see this tournament as cancelled. Type its name to confirm.',
  },
};

/** A draft has never been public and nobody has registered for it, so unlike
 *  archive/cancel it can just be gone — no restore UI, unlike archived_at. */
export function canDelete(phase: Phase): boolean {
  return phase === PHASE.draft;
}

export const DELETE_COPY = {
  label: 'Delete tournament',
  blurb: 'Permanently removes this draft. It has never been public and nobody has registered — there is nothing to preserve.',
  confirmHint: 'This cannot be undone. Type its name to confirm.',
};

/* ── Granular Division Lifecycle & Badges ───────────────────────── */

export type DivisionLifecycleStage =
  | 'draft'
  | 'upcoming'
  | 'registration-open'
  | 'waitlist-open'
  | 'registration-closed'
  | 'draw-draft'
  | 'draw-locked'
  | 'in-progress'
  | 'completed';

export interface DivisionStatusContext {
  id?: string;
  name: string;
  cap: number;
  filled: number;
  registrationOpens?: string;
  registrationCloses?: string;
  isDrawLocked?: boolean;
  hasMatches?: boolean;
  inProgressMatches?: number;
  completedMatches?: number;
  totalMatches?: number;
}

export function getDivisionLifecycleStage(
  d: DivisionStatusContext,
  now: Date = new Date(),
): DivisionLifecycleStage {
  // If match play is done
  if (d.totalMatches && d.totalMatches > 0 && d.completedMatches === d.totalMatches) {
    return 'completed';
  }

  // If matches are currently being scored or in progress
  if (d.inProgressMatches && d.inProgressMatches > 0) {
    return 'in-progress';
  }

  // If draw is locked and scheduled
  if (d.isDrawLocked) {
    return 'draw-locked';
  }

  // If matches exist / draw generated but unlocked
  if (d.hasMatches) {
    return 'draw-draft';
  }

  // Registration window states
  const regState = divisionRegistrationState(
    {
      registrationOpens: d.registrationOpens || '',
      registrationCloses: d.registrationCloses || '',
    },
    now,
  );

  if (regState === 'opens-soon') {
    return 'upcoming';
  }

  if (regState === 'closed') {
    return 'registration-closed';
  }

  // regState === 'open'
  if (d.cap > 0 && d.filled >= d.cap) {
    return 'waitlist-open';
  }

  return 'registration-open';
}

/** Player-facing action badge */
export function getPlayerActionBadge(
  d: DivisionStatusContext,
  now: Date = new Date(),
): { label: string; variant: 'open' | 'highlight' | 'status' | 'live' | 'outline' } {
  const stage = getDivisionLifecycleStage(d, now);
  switch (stage) {
    case 'in-progress':
      return { label: 'Live Scores', variant: 'live' };
    case 'completed':
      return { label: 'Results', variant: 'status' };
    case 'draw-locked':
    case 'draw-draft':
      return { label: 'Bracket View', variant: 'highlight' };
    case 'registration-open':
      return { label: 'Register Now', variant: 'open' };
    case 'waitlist-open':
      return { label: 'Join Waitlist', variant: 'highlight' };
    case 'upcoming': {
      if (d.registrationOpens) {
        const opens = new Date(d.registrationOpens);
        if (!isNaN(opens.getTime())) {
          const formatted = opens.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
          return { label: `Opens ${formatted}`, variant: 'status' };
        }
      }
      return { label: 'Opens Soon', variant: 'status' };
    }
    case 'registration-closed':
    default:
      return { label: 'Registration Closed', variant: 'status' };
  }
}

/** Organizer-facing operational status badge */
export function getOrganizerDivisionBadge(
  d: DivisionStatusContext,
  now: Date = new Date(),
): { label: string; variant: 'open' | 'highlight' | 'status' | 'live' | 'outline' } {
  const stage = getDivisionLifecycleStage(d, now);
  switch (stage) {
    case 'in-progress':
      return { label: 'Live Playing', variant: 'live' };
    case 'completed':
      return { label: 'Completed', variant: 'status' };
    case 'draw-locked':
      return { label: 'Draw Locked', variant: 'highlight' };
    case 'draw-draft':
      return { label: 'Draw Unlocked', variant: 'outline' };
    case 'registration-open':
      return { label: `${d.filled}/${d.cap} Registered`, variant: 'open' };
    case 'waitlist-open':
      return { label: `Full (${d.filled}/${d.cap}) · Waitlist`, variant: 'highlight' };
    case 'upcoming':
      return { label: 'Registration Upcoming', variant: 'status' };
    case 'registration-closed':
      return { label: `Closed (${d.filled}/${d.cap})`, variant: 'status' };
    case 'draft':
    default:
      return { label: 'Draft Setup', variant: 'status' };
  }
}

/** Has the first day arrived? True from the start date onwards, so a
 *  finished tournament still counts as started — pages that lead with play
 *  (schedule, rounds) should keep leading with it once there are results.
 *  Local and UTC are both accepted, as in isTournamentLiveDate below: a
 *  viewer whose clock has rolled over should not be told the event hasn't
 *  begun. */
export function hasTournamentStarted(
  startDate?: string | null,
  now: Date = new Date(),
): boolean {
  if (!startDate) return false;
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayLocal = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const todayUTC = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  return todayLocal >= startDate || todayUTC >= startDate;
}

/** Checks if a tournament is currently live based on its date range (inclusive). */
export function isTournamentLiveDate(
  startDate?: string | null,
  endDate?: string | null,
  now: Date = new Date(),
): boolean {
  if (!startDate) return false;
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayLocal = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const todayUTC = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  const end = endDate || startDate;
  return (
    (todayLocal >= startDate && todayLocal <= end) ||
    (todayUTC >= startDate && todayUTC <= end)
  );
}
