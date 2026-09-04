import type { TournamentDetail, DetailMatch, DetailMatchPlayer } from './data.ts';
import { joinTeamName } from './teamName.ts';

export const SET_COLUMNS = 3;

export interface SetScore {
  a: number;
  b: number;
}

export interface CourtRow {
  court: string;
  division: string;
  teamA: string;
  teamB: string;
  scoreA: number | null;         // points in the set currently on court
  scoreB: number | null;
  lastScorer: 'a' | 'b' | null;  // side that won the most recent point
  startedAt: number | null;      // epoch ms the match clock runs from
  sets: (SetScore | null)[];     // finished sets, padded to SET_COLUMNS
  hasLive: boolean;
  upNext: string | null;
  upNextTime: string | null;
}

export function playerNames(players: DetailMatchPlayer[]): string {
  return joinTeamName(players.map(p => p.name)) || 'TBD';
}

export function formatUpNext(
  match: { teamA: DetailMatchPlayer[]; teamB: DetailMatchPlayer[]; roundName?: string; division?: string } | undefined
): string | null {
  if (!match) return null;
  const nameA = playerNames(match.teamA);
  const nameB = playerNames(match.teamB);
  if (nameA === 'TBD' && nameB === 'TBD') {
    const prefix = [match.roundName, match.division].filter(Boolean).join(' · ');
    return prefix ? `${prefix} · TBD vs TBD` : 'TBD vs TBD';
  }
  return `${nameA} vs ${nameB}`;
}

export function buildCourtRows(detail: TournamentDetail): CourtRow[] {
  type TaggedMatch = DetailMatch & { division: string; roundName?: string };
  const all: TaggedMatch[] = [];
  detail.divisions.forEach(d =>
    d.bracket.forEach(r =>
      r.matches.forEach(m => all.push({ ...m, division: d.label, roundName: r.round }))
    )
  );

  const courts = new Map<string, { live?: TaggedMatch; upcoming: TaggedMatch[] }>();
  for (const m of all) {
    if (m.status === 'done') continue;
    const key = m.court || 'Unassigned';
    if (!courts.has(key)) courts.set(key, { upcoming: [] });
    const entry = courts.get(key)!;
    if (m.status === 'live') {
      if (!entry.live) entry.live = m;
    } else {
      entry.upcoming.push(m);
    }
  }

  const rows: CourtRow[] = [];
  for (const [court, entry] of courts) {
    // Sort upcoming matches chronologically by date and time so earlier tournament
    // days take precedence over later days (e.g. Day 1 09:30 before Day 2 09:00).
    entry.upcoming.sort((a, b) => {
      const keyA = `${a.scheduledDate ?? '9999-99-99'} ${a.time || '99:99'}`;
      const keyB = `${b.scheduledDate ?? '9999-99-99'} ${b.time || '99:99'}`;
      return keyA.localeCompare(keyB);
    });

    // Skip the match currently shown as live from the queue
    const next = entry.upcoming[0];
    const upNext = formatUpNext(next);
    const upNextTime = next?.time || null;

    if (entry.live) {
      const m = entry.live;
      const a = m.scoreA ?? [];
      const b = m.scoreB ?? [];
      /* applyLiveScores appends the set on court to the finished ones, so
       * the last entry is the running score and everything before it is a
       * result. The card shows those separately — big numbers for the set
       * being played, chips for the ones already won. */
      const setCount = Math.max(a.length, b.length);
      const finished = Math.max(setCount - 1, 0);
      const sets: (SetScore | null)[] = [];
      for (let i = 0; i < SET_COLUMNS; i++) {
        sets.push(i < finished ? { a: a[i] ?? 0, b: b[i] ?? 0 } : null);
      }
      rows.push({
        court,
        division: m.division,
        teamA: playerNames(m.teamA),
        teamB: playerNames(m.teamB),
        scoreA: setCount ? a[setCount - 1] ?? 0 : 0,
        scoreB: setCount ? b[setCount - 1] ?? 0 : 0,
        lastScorer: m.lastScorer ?? null,
        startedAt: m.startedAt ?? null,
        sets,
        hasLive: true,
        upNext,
        upNextTime,
      });
    } else if (next) {
      rows.push({
        court,
        division: next.division,
        teamA: '',
        teamB: '',
        scoreA: null,
        scoreB: null,
        lastScorer: null,
        startedAt: null,
        sets: Array(SET_COLUMNS).fill(null),
        hasLive: false,
        upNext,
        upNextTime,
      });
    }
  }

  rows.sort((x, y) => Number(y.hasLive) - Number(x.hasLive) || x.court.localeCompare(y.court, undefined, { numeric: true }));
  return rows;
}
