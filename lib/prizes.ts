import { formatMoney } from './currency.ts';

/* Prize money is defined per division, not per tournament: a Women's Open and
 * a Mixed 4s at the same event pay out differently, and the entry fee that
 * funds them is already a division-level number.
 *
 * It lives in divisions.settings (migration 0003) as `prizes`, so there is no
 * column for it and no migration to run. Amounts are plain numbers in the
 * division's own settings.currency — see lib/currency. */

export interface PrizePlacing {
  /** Free label, so an organizer can pay a placing ("1st") or an award
   *  ("Best Spiker", "Best Dressed Team") without a fixed taxonomy. */
  place: string;
  /** Cash in the division's currency. 0 is legitimate — a trophy-only
   *  placing still belongs on the payout table, described by `note`. */
  amount: number;
  /** What comes with the cash, if anything: "+ 2 nights at Sunset Resort". */
  note: string;
}

export interface DivisionPrizes {
  placings: PrizePlacing[];
  /** Free text under the table — conditions, sponsor credits, and the home
   *  of every legacy `prizePool` string written before placings existed. */
  note: string;
}

/** What a division starts with when the organizer first opens the editor. */
export const DEFAULT_PLACES = ['1st', '2nd', '3rd'];

/* An organizer paying out more than this is not using a form field, and an
 * unbounded array is a jsonb blob a hand-made request can grow forever. */
const MAX_PLACINGS = 12;

export const emptyPrizes = (): DivisionPrizes => ({ placings: [], note: '' });

/** Placings pre-filled with the usual podium, ready for the editor. */
export const defaultPlacings = (): PrizePlacing[] =>
  DEFAULT_PLACES.map(place => ({ place, amount: 0, note: '' }));

function readPlacing(raw: unknown): PrizePlacing | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const place = typeof r.place === 'string' ? r.place.trim() : '';
  const amount = typeof r.amount === 'number' && Number.isFinite(r.amount)
    ? Math.max(0, Math.round(r.amount))
    : 0;
  const note = typeof r.note === 'string' ? r.note.trim() : '';
  // A row with no label is not a placing anyone can read, whatever it pays.
  if (!place) return null;
  return { place, amount, note };
}

/** Read prizes out of a division's settings blob.
 *
 *  Divisions written before this existed carry a single free-text
 *  `prizePool` string. That text is not thrown away and it is not guessed at
 *  — it becomes the note under an empty table, which is exactly how the
 *  public page rendered it before. */
export function readPrizes(settings: Record<string, unknown> | null | undefined): DivisionPrizes {
  const s = settings ?? {};

  if (Array.isArray(s.prizes)) {
    const placings = s.prizes.map(readPlacing).filter((p): p is PrizePlacing => p !== null);
    const note = typeof s.prizeNote === 'string' ? s.prizeNote.trim() : '';
    return { placings: placings.slice(0, MAX_PLACINGS), note };
  }

  const legacy = typeof s.prizePool === 'string' ? s.prizePool.trim() : '';
  return { placings: [], note: legacy };
}

/** Sanitise what the editor sends before it is written to settings. */
export function toStoredPrizes(prizes: DivisionPrizes): { prizes: PrizePlacing[]; prizeNote: string } {
  const placings = (prizes.placings ?? [])
    .map(readPlacing)
    .filter((p): p is PrizePlacing => p !== null)
    .slice(0, MAX_PLACINGS);
  return { prizes: placings, prizeNote: (prizes.note ?? '').trim() };
}

/** Total cash on the table for a division. Non-cash placings add nothing. */
export function prizeTotal(prizes: DivisionPrizes): number {
  return prizes.placings.reduce((sum, p) => sum + p.amount, 0);
}

/** True when there is anything at all to show a player. */
export function hasPrizes(prizes: DivisionPrizes): boolean {
  return prizes.placings.length > 0 || prizes.note.length > 0;
}

/** "฿50,000 in prizes" — the one-line version used on cards and lists. */
export function prizeSummary(prizes: DivisionPrizes, currency: string): string | null {
  const total = prizeTotal(prizes);
  if (total > 0) return `${formatMoney(total, currency)} in prizes`;
  return hasPrizes(prizes) ? 'Prizes awarded' : null;
}

export interface PrizeBearingDivision {
  prizeTotal: number;
  currency: string;
}

/** Roll several divisions up into one headline for a tournament card.
 *
 *  Divisions can be priced in different currencies, and adding baht to
 *  dollars would print a number that is simply false. When they disagree the
 *  card says there is prize money without claiming how much. */
export function tournamentPrizeLabel(divisions: PrizeBearingDivision[]): string | null {
  const paying = divisions.filter(d => d.prizeTotal > 0);
  if (paying.length === 0) return null;

  const currencies = new Set(paying.map(d => d.currency));
  if (currencies.size > 1) return 'Prize money';

  const total = paying.reduce((sum, d) => sum + d.prizeTotal, 0);
  return formatMoney(total, paying[0].currency);
}
