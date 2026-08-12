/* ── A tournament's lifecycle ─────────────────────────────────────
 *
 * Two independent things, deliberately not folded into one column:
 *
 *   phase        where the event is: draft → announced → open → closed
 *   archived_at  hidden from every list; only for events nobody committed to
 *   cancelled_at called off; stays visible so registered players find out
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
  3: 'Open',
  4: 'Closed',
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
