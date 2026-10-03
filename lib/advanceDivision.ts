import { supabaseAdmin } from './supabaseAdmin';
import { planAdvancement, type AdvanceDivision, type SideChange } from './advancement';

/* Carries a division's results forward into its knockout — pool positions
 * into the slots the crossing drew, winners into the next round, beaten
 * semifinalists into the play-off for 3rd. Called after every write of a
 * result, by the referee's finalize and the organizer's own score entry
 * alike; what moves and why lives in lib/advancement.
 *
 * Each side is written as a compare-and-set against the team the plan read
 * there. Two results landing at once each plan from their own read; the
 * guard means a plan made from a read that is already stale finds the side
 * moved and leaves it, rather than putting back what the other just
 * replaced. The last plan to run has read both results, so it is the one
 * that sticks. */

interface DivisionRow {
  settings: { draw?: AdvanceDivision['drawConfig'] & { slots?: Record<string, string[]> } } | null;
  teams: { id: string; name: string; seed: number | null; status: string }[];
  rounds: {
    sequence: number;
    format: string;
    matches: {
      id: string;
      team_a_id: string | null;
      team_b_id: string | null;
      winner_team_id: string | null;
      status: string;
      score_a: number[] | null;
      score_b: number[] | null;
    }[];
  }[];
}

export async function advanceDivision(divisionId: string): Promise<SideChange[]> {
  const { data, error } = await supabaseAdmin
    .from('divisions')
    .select(`
      settings,
      teams ( id, name, seed, status ),
      rounds ( sequence, format, matches ( id, team_a_id, team_b_id, winner_team_id, status, score_a, score_b ) )
    `)
    .eq('id', divisionId)
    .maybeSingle();
  if (error) throw new Error(`Failed to read division for advancement: ${error.message}`);
  if (!data) return [];
  const row = data as unknown as DivisionRow;

  const draw = row.settings?.draw ?? null;
  const slots = draw?.slots ?? {};
  const division: AdvanceDivision = {
    drawConfig: draw,
    teams: [...row.teams]
      .map(t => ({ ...t, seed: t.seed ?? 0 }))
      .sort((a, b) => a.seed - b.seed),
    rounds: row.rounds.map(r => {
      const order = new Map((slots[String(r.sequence)] ?? []).map((id, i) => [id, i]));
      return {
        sequence: r.sequence,
        format: r.format,
        matches: [...r.matches]
          .sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity))
          .map(m => ({
            id: m.id,
            teamAId: m.team_a_id,
            teamBId: m.team_b_id,
            winnerTeamId: m.winner_team_id,
            status: m.status,
            scoreA: m.score_a,
            scoreB: m.score_b,
          })),
      };
    }),
  };

  const applied: SideChange[] = [];
  for (const change of planAdvancement(division)) {
    const column = change.side === 'a' ? 'team_a_id' : 'team_b_id';
    // A bye advances the team it names — the shape a plain knockout's byes
    // are drawn with. Anything else is a match still to be played.
    const update = change.bye
      ? { [column]: change.to, winner_team_id: change.to, updated_at: new Date().toISOString() }
      : { [column]: change.to, updated_at: new Date().toISOString() };
    let query = supabaseAdmin
      .from('matches')
      .update(update)
      .eq('id', change.matchId)
      .eq('status', change.bye ? 'done' : 'upcoming')
      .is('score_a', null);
    query = change.from === null ? query.is(column, null) : query.eq(column, change.from);
    const { data: written, error: writeError } = await query.select('id');
    if (writeError) throw new Error(`Failed to advance match ${change.matchId}: ${writeError.message}`);
    if (written && written.length > 0) applied.push(change);
  }
  return applied;
}
