import type { TournamentDetail } from './data';

/* ── Live scores, merged into the detail both read paths already use ──
 *
 * getTournamentDetail returns score_a/score_b straight from Postgres,
 * which are only written when a match is finalized — so until this merge
 * existed, a match in progress showed no score anywhere except on the
 * referee's own screen.
 *
 * Rather than teach the dashboard and the public bracket to render a
 * second kind of score, this folds the in-progress numbers into the same
 * scoreA/scoreB arrays they already draw: completed sets, then the set
 * being played. Neither page needed a rendering change.
 */

export interface LiveMatchScore {
  sets: { a: number; b: number }[];
  a: number;
  b: number;
}

export type LiveScoreMap = Record<string, LiveMatchScore>;

/** Read the current scores for a tournament. Never throws — a failure here
 *  must leave the page showing what Postgres knows, not an error. */
export async function fetchLiveScores(slug: string): Promise<LiveScoreMap> {
  try {
    const res = await fetch(`/api/tournaments/${slug}/live`);
    if (!res.ok) return {};
    const body = await res.json();
    return (body.scores ?? {}) as LiveScoreMap;
  } catch {
    return {};
  }
}

/* Fold live scores into a detail payload.
 *
 * Returns the original object untouched when there is nothing live, so the
 * common case doesn't churn React's referential equality and re-render two
 * pages' worth of brackets for no reason. */
export function applyLiveScores(detail: TournamentDetail, live: LiveScoreMap): TournamentDetail {
  if (Object.keys(live).length === 0) return detail;

  return {
    ...detail,
    divisions: detail.divisions.map(d => ({
      ...d,
      bracket: d.bracket.map(r => ({
        ...r,
        matches: r.matches.map(m => {
          const l = live[m.id];
          // A finalized match keeps its Postgres result even if a stale key
          // lingers in Redis — the durable score always wins.
          if (!l || m.status === 'done') return m;
          return {
            ...m,
            // Completed sets, then the one on court. The in-progress set is
            // included at 0–0 so a court that has just started reads as
            // playing rather than as having no score at all.
            scoreA: [...l.sets.map(s => s.a), l.a],
            scoreB: [...l.sets.map(s => s.b), l.b],
            status: 'live' as const,
          };
        }),
      })),
    })),
  };
}
