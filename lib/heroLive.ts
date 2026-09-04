/* ── What is on court right now, across every public tournament ───
 *
 * The homepage hero card used to be a hand-written scoreboard: one
 * invented tournament, four invented players, a score that ticked up on
 * a timer. This is the real feed behind it.
 *
 * It exists because every other live read in the app is scoped to one
 * slug — /api/tournaments/[slug]/live answers "what is the score in THIS
 * event", and the homepage doesn't know which event to ask about. The
 * route these types describe answers the other question: "what is being
 * played anywhere, right now".
 */

export interface HeroPlayer {
  name: string;
  avatarUrl: string | null;
}

export interface HeroTeam {
  /** Display name: first names on a slash ("Aroon/Niran"), or the club
   *  name when the team registered under one. */
  name: string;
  players: HeroPlayer[];
}

export interface HeroLiveMatch {
  matchId: string;
  tournamentSlug: string;
  tournamentTitle: string;
  location: string;
  dateLabel: string;
  court: string;
  division: string;
  round: string;
  /* 'live' means the referee has scored at least one point and hasn't
   * finalized — the only state that earns the LIVE badge. 'upcoming' is
   * the gap between matches: the card keeps its shape and shows a start
   * time where the score would be. */
  status: 'live' | 'upcoming';
  startTime: string; // 'HH:MM', '' when the match isn't scheduled yet
  teamA: HeroTeam;
  teamB: HeroTeam;
  sets: { a: number; b: number }[]; // finished sets only
  pointsA: number;                  // the set currently on court
  pointsB: number;
  lastScorer: 'a' | 'b' | null;
  /* Epoch ms of the referee's last write on this court — null for a match
   * that hasn't started. Every point stamps one, so this is how the card
   * knows which court is liveliest without diffing scores between polls. */
  updatedAt: number | null;
}

/** Never throws: a hero card with nothing in it is a far better failure
 *  than a homepage that doesn't render. */
export async function fetchHeroLiveMatches(): Promise<HeroLiveMatch[]> {
  try {
    const res = await fetch('/api/live/now');
    if (!res.ok) return [];
    const body = await res.json();
    return (body.matches ?? []) as HeroLiveMatch[];
  } catch {
    return [];
  }
}


/* ── Which two courts the card is showing ─────────────────────────
 *
 * The card follows the action: the court that scored most recently takes a
 * slot, and the second liveliest takes the other. Two rules keep that from
 * turning into a twitch.
 *
 * A court already on screen keeps the slot it is in. The ranking decides
 * *which* two courts show, never where they sit — otherwise two busy
 * courts would trade places on every point, which reads as the card
 * flinching rather than as news.
 *
 * And a court that has just arrived is held for a few seconds before
 * anything may push it out, so a six-court event doesn't repaint faster
 * than it can be read.
 *
 * Both slots always belong to one tournament, because the photo behind
 * them carries one event's title, location and dates.
 */

export const SLOT_DWELL_MS = 6_000;
const SLOT_COUNT = 2;

export interface SlotState {
  /** The event on the photo. */
  slug: string | null;
  /** Match id in each slot, or null while a slot is empty. */
  ids: (string | null)[];
  /** Epoch ms each slot's current occupant arrived, for the dwell check. */
  since: number[];
}

export const EMPTY_SLOTS: SlotState = {
  slug: null,
  ids: Array(SLOT_COUNT).fill(null),
  since: Array(SLOT_COUNT).fill(0),
};

export function nextSlots(prev: SlotState, matches: HeroLiveMatch[], now: number): SlotState {
  if (matches.length === 0) return EMPTY_SLOTS;

  const byId = new Map(matches.map((m) => [m.matchId, m]));

  /* Which event is the card watching? The one whose court scored last —
   * but only once the pair on screen has had its dwell, so a second
   * tournament trading points can't yank the card away mid-glance. */
  const hottest = matches.reduce<HeroLiveMatch | null>(
    (best, m) =>
      m.updatedAt !== null && (best === null || m.updatedAt > (best.updatedAt ?? 0)) ? m : best,
    null
  );
  const stillRunning = prev.slug !== null && matches.some((m) => m.tournamentSlug === prev.slug);
  const cardSince = Math.max(...prev.since);

  let slug: string;
  if (!stillRunning) {
    // Nothing to hold on to — take the hottest, or the feed's own order
    // when no court has started yet.
    slug = hottest?.tournamentSlug ?? matches[0].tournamentSlug;
  } else if (hottest && hottest.tournamentSlug !== prev.slug && now - cardSince >= SLOT_DWELL_MS) {
    slug = hottest.tournamentSlug;
  } else {
    slug = prev.slug!;
  }

  /* The two liveliest courts at that event. Courts yet to start have no
   * timestamp and sort to the back, so they only appear as filler. */
  const target = matches
    .filter((m) => m.tournamentSlug === slug)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, SLOT_COUNT)
    .map((m) => m.matchId);

  const ids = [...prev.ids];
  const since = [...prev.since];

  /* A court from another event has to go whatever its dwell says — leaving
   * it would caption it with the wrong tournament. */
  for (let i = 0; i < SLOT_COUNT; i++) {
    const held = ids[i] ? byId.get(ids[i]!) : undefined;
    if (!held || held.tournamentSlug !== slug) ids[i] = null;
  }

  const kept = new Set(ids.filter(Boolean) as string[]);
  const incoming = target.filter((id) => !kept.has(id));

  for (let i = 0; i < SLOT_COUNT; i++) {
    const held = ids[i];
    if (held && target.includes(held)) continue;            // still one of the two
    if (held && now - since[i] < SLOT_DWELL_MS) continue;   // only just arrived
    const id = incoming.shift();
    if (id === undefined) continue;   // nothing waiting; leave the slot as it is
    ids[i] = id;
    since[i] = now;
  }

  return { slug, ids, since };
}
