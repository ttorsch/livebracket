import 'server-only';
import { supabaseAdmin } from './supabaseAdmin';
import { formatDateRange } from './data';
import { PHASE } from './tournamentLifecycle';
import { whatsappLink } from './whatsappNumber';
import { isDemoTournament } from './demoTournament';

/* ── The card behind an organizer's name ──────────────────────────
 *
 * Clicking the organizer on a tournament card asks one question — "who
 * is running this, and what else do they run?" — and this answers it:
 * who they are, what is coming up, and what they have already put on.
 *
 * ── Why the same filters as the public list ──────────────────────
 * Every event named here is one an anonymous visitor could already have
 * found on the homepage, and the rows link straight into those pages. So
 * the filtering below is deliberately the same as getPublicTournaments
 * plus the homepage's own `phase >= announced`: drafts, deleted rows,
 * archived events, templates and demo sandboxes stay out. A card that
 * advertised a draft would be a leak; one that linked to an archived
 * event would be a dead end.
 *
 * Read through the service role rather than the anon client because this
 * is server-side and the filtering above — not RLS — is what decides
 * what a visitor sees. Nothing private is selected: name, photo and
 * location are already on the public cards, and the counts are arithmetic
 * over published registrations. The organizer's email is never read.
 */

export interface OrganizerEvent {
  /** The slug, which is what /tournament/[id] is addressed by. */
  slug: string;
  title: string;
  /** Formatted the same way the homepage cards do it. */
  dateLabel: string;
  location: string;
  /** Every team that signed up, waitlisted and not yet paid included —
   *  the question this answers is how much interest the event drew. */
  teams: number;
  /** Running right now: started, not yet finished. Upcoming only. */
  live: boolean;
  cancelled: boolean;
}

export interface OrganizerCard {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** The organizer's own place — the "Location" box on their profile.
   *  Called `hometown` here because that is the column and what the rest
   *  of the app calls it; `OrganizerEvent.location` is a different thing
   *  entirely (the venue an event is held at), and naming both `location`
   *  would invite exactly one bug. */
  hometown: string | null;
  /** The wa.me link, already built, or null when no number is set. The
   *  card hands over a link rather than digits so no caller has to know
   *  how one is assembled — and so a missing number is plainly an absent
   *  button rather than a link to nowhere. */
  whatsappUrl: string | null;
  /** Soonest first — what is next is the top of the list. */
  upcoming: OrganizerEvent[];
  /** Most recent first — the opposite order, for the same reason. */
  past: OrganizerEvent[];
}

interface EventRow {
  slug: string;
  title: string;
  location: string;
  start_date: string;
  end_date: string | null;
  is_one_day: boolean;
  phase: number;
  cancelled_at: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  /* Both arrive with migration 0019, which this database has not run —
   * the columns genuinely do not exist yet, so selecting them would fail
   * the whole query. Declared optional and checked anyway: the slug
   * prefixes below are what actually excludes demo clones today, and the
   * day 0019 lands these become one line in EVENT_SELECT rather than a
   * hunt through the filter. */
  is_template?: boolean | null;
  sandbox_id?: string | null;
  divisions: { teams: { id: string }[] }[];
}

const EVENT_SELECT =
  'slug, title, location, start_date, end_date, is_one_day, phase, ' +
  'cancelled_at, archived_at, deleted_at, ' +
  'divisions(teams(id))';

/** Today where the tournament is, not where the server is — the same
 *  local-date comparison the homepage uses to decide what has passed. */
function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/* The demo sandboxes clone real events under predictable slugs, and the
 * seeded template is one row that is not an event at all. Same exclusion
 * list the public tournament list carries, for the same reason — and the
 * slug prefixes are the half of it that does any work right now. */
function isPublicEvent(t: EventRow): boolean {
  if (t.deleted_at || t.archived_at) return false;
  if (t.phase < PHASE.announced) return false;
  if (!t.slug) return false;
  return !isDemoTournament(t);
}

function toEvent(t: EventRow, today: string): OrganizerEvent {
  const end = t.end_date || t.start_date;
  return {
    slug: t.slug,
    title: t.title,
    dateLabel: formatDateRange(t.start_date, t.end_date, t.is_one_day),
    location: t.location,
    /* Flattened rather than counted per division: the number on the row
     * is how many teams entered the *event*. */
    teams: (t.divisions ?? []).reduce((sum, d) => sum + (d.teams ?? []).length, 0),
    live: t.start_date <= today && end >= today && !t.cancelled_at,
    cancelled: !!t.cancelled_at,
  };
}

/**
 * Everything the card shows, or null when there is no such organizer.
 *
 * One round trip for the organizer and one for their events. The events
 * query embeds team rows only to count them — no team is ever returned
 * to the client, and no name on a roster leaves this function.
 */
export async function getOrganizerCard(organizerId: string): Promise<OrganizerCard | null> {
  const { data: organizer, error } = await supabaseAdmin
    .from('organizers')
    .select('id, name, avatar_url, hometown, whatsapp')
    .eq('id', organizerId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load organizer: ${error.message}`);
  if (!organizer) return null;

  const { data, error: eventsError } = await supabaseAdmin
    .from('tournaments')
    .select(EVENT_SELECT)
    .eq('organizer_id', organizerId)
    .order('start_date', { ascending: true });

  if (eventsError) throw new Error(`Failed to load events: ${eventsError.message}`);

  const today = todayLocal();
  const rows = ((data ?? []) as unknown as EventRow[]).filter(isPublicEvent);

  /* An event that has not finished is "upcoming", which is what puts a
   * tournament running today at the top of that tab rather than into a
   * history of things already done. */
  const upcoming: OrganizerEvent[] = [];
  const past: OrganizerEvent[] = [];
  for (const row of rows) {
    const end = row.end_date || row.start_date;
    (end >= today ? upcoming : past).push(toEvent(row, today));
  }

  return {
    id: organizer.id as string,
    name: (organizer.name as string) ?? 'Organizer',
    avatarUrl: (organizer.avatar_url as string | null) ?? null,
    hometown: (organizer.hometown as string | null) ?? null,
    whatsappUrl: whatsappLink(organizer.whatsapp as string | null),
    // Already ascending from the query; history reads better newest first.
    upcoming,
    past: past.reverse(),
  };
}
