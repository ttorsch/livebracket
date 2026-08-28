import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getCurrentUser } from '../../../../lib/auth';

export interface PartnerStat {
  name: string;
  avatarUrl: string | null;
  meta: string;
  record: string;
  pct: string;
}

export interface PlayerStatsResponse {
  matchesCount: number;
  wins: number;
  losses: number;
  winRate: number;
  setsWon: number;
  setsLost: number;
  bestFinish: string | null;
  longestStreak: number;
  partners: PartnerStat[];
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const userFullName = (
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.user_metadata?.display_name ||
    ''
  ).trim();

  // 1. Find all team IDs associated with this user
  const userTeamIds = new Set<string>();

  // A. Teams where registered_by = user.id
  const { data: regTeams } = await supabaseAdmin
    .from('teams')
    .select('id')
    .eq('registered_by', user.id);

  if (regTeams) {
    regTeams.forEach((t) => userTeamIds.add(t.id));
  }

  // B. Teams from players table by user_id or exact verified email
  let playerQuery = supabaseAdmin
    .from('players')
    .select('team_id, user_id, email, name');

  if (user.email) {
    playerQuery = playerQuery.or(`user_id.eq.${user.id},email.eq.${user.email.toLowerCase()}`);
  } else {
    playerQuery = playerQuery.eq('user_id', user.id);
  }

  const { data: playerRows } = await playerQuery;
  if (playerRows) {
    playerRows.forEach((p) => {
      if (p.team_id) userTeamIds.add(p.team_id);
    });
  }

  const teamIdList = Array.from(userTeamIds);

  if (teamIdList.length === 0) {
    const emptyStats: PlayerStatsResponse = {
      matchesCount: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      setsWon: 0,
      setsLost: 0,
      bestFinish: null,
      longestStreak: 0,
      partners: [],
    };
    return NextResponse.json({ stats: emptyStats });
  }

  // 2. Fetch all matches for these teams
  const { data: matchesData } = await supabaseAdmin
    .from('matches')
    .select(`
      id, court, scheduled_time, status, score_a, score_b, winner_team_id, updated_at,
      team_a_id, team_b_id,
      team_a:teams!matches_team_a_id_fkey(id, name),
      team_b:teams!matches_team_b_id_fkey(id, name),
      rounds!inner (
        name, sequence, format,
        divisions!inner (
          id, name,
          tournaments!inner ( slug, title, start_date )
        )
      )
    `)
    .or(`team_a_id.in.(${teamIdList.join(',')}),team_b_id.in.(${teamIdList.join(',')})`)
    .order('scheduled_time', { ascending: true });

  let matchesCount = 0;
  let wins = 0;
  let losses = 0;
  let setsWon = 0;
  let setsLost = 0;
  let currentStreak = 0;
  let longestStreak = 0;

  // Track team match wins/losses for partner aggregation
  const teamMatchRecord = new Map<string, { wins: number; losses: number }>();
  for (const tid of teamIdList) {
    teamMatchRecord.set(tid, { wins: 0, losses: 0 });
  }

  // Track best finish
  let bestFinishRank = 0;
  let bestFinishText: string | null = null;

  const matches = matchesData || [];

  for (const m of matches) {
    const isTeamA = userTeamIds.has(m.team_a_id);
    const isTeamB = userTeamIds.has(m.team_b_id);
    if (!isTeamA && !isTeamB) continue;

    const userTeamId = isTeamA ? m.team_a_id : m.team_b_id;
    const scoreUser = isTeamA ? m.score_a : m.score_b;
    const scoreOpp = isTeamA ? m.score_b : m.score_a;

    const isDone =
      m.status === 'done' ||
      m.status === 'finished' ||
      m.winner_team_id !== null ||
      (scoreUser && scoreOpp && scoreUser.length > 0);

    if (!isDone) continue;

    let setsWonInMatch = 0;
    let setsLostInMatch = 0;

    if (scoreUser && scoreOpp) {
      const minLen = Math.min(scoreUser.length, scoreOpp.length);
      for (let i = 0; i < minLen; i++) {
        if (scoreUser[i] > scoreOpp[i]) {
          setsWonInMatch++;
        } else if (scoreOpp[i] > scoreUser[i]) {
          setsLostInMatch++;
        }
      }
    }

    setsWon += setsWonInMatch;
    setsLost += setsLostInMatch;

    let isWin = false;
    if (m.winner_team_id) {
      isWin = m.winner_team_id === userTeamId;
    } else if (setsWonInMatch !== setsLostInMatch) {
      isWin = setsWonInMatch > setsLostInMatch;
    } else if (scoreUser && scoreOpp) {
      const sumUser = (scoreUser as number[]).reduce((a: number, b: number) => a + b, 0);
      const sumOpp = (scoreOpp as number[]).reduce((a: number, b: number) => a + b, 0);
      isWin = sumUser > sumOpp;
    }

    matchesCount++;
    const tRecord = teamMatchRecord.get(userTeamId) || { wins: 0, losses: 0 };

    if (isWin) {
      wins++;
      tRecord.wins++;
      currentStreak++;
      if (currentStreak > longestStreak) {
        longestStreak = currentStreak;
      }
    } else {
      losses++;
      tRecord.losses++;
      currentStreak = 0;
    }
    teamMatchRecord.set(userTeamId, tRecord);

    // Evaluate finish rank for tournament
    const roundName = (m.rounds as unknown as { name?: string })?.name || '';
    const tournamentTitle = (m.rounds as unknown as { divisions?: { tournaments?: { title?: string } } })
      ?.divisions?.tournaments?.title || 'Tournament';

    let rank = 1;
    let rankLabel = 'Participant';

    if (/final/i.test(roundName) && !/semi/i.test(roundName) && !/quarter/i.test(roundName)) {
      if (isWin) {
        rank = 5;
        rankLabel = `Winner · ${tournamentTitle}`;
      } else {
        rank = 4;
        rankLabel = `Finalist · ${tournamentTitle}`;
      }
    } else if (/semi/i.test(roundName)) {
      rank = 3;
      rankLabel = `Semifinalist · ${tournamentTitle}`;
    } else if (/quarter/i.test(roundName)) {
      rank = 2;
      rankLabel = `Quarterfinalist · ${tournamentTitle}`;
    }

    if (rank > bestFinishRank) {
      bestFinishRank = rank;
      bestFinishText = rankLabel;
    }
  }

  const winRate = matchesCount > 0 ? Math.round((wins / matchesCount) * 100) : 0;

  // 3. Aggregate Partners
  // Query all players on the user's teams
  const { data: allTeammates } = await supabaseAdmin
    .from('players')
    .select(`
      id, name, user_id, team_id,
      teams!inner (
        id, division_id,
        divisions!inner (
          id, name,
          tournaments!inner ( title )
        )
      )
    `)
    .in('team_id', teamIdList);

  const partnerMap = new Map<
    string,
    {
      name: string;
      userId: string | null;
      divisions: Set<string>;
      wins: number;
      losses: number;
    }
  >();

  if (allTeammates) {
    for (const p of allTeammates) {
      const pName = (p.name || '').trim();
      const pUserId = p.user_id;

      // Skip user themselves
      if (pUserId && pUserId === user.id) continue;
      if (userFullName && pName.toLowerCase() === userFullName.toLowerCase()) continue;
      if (!pName) continue;

      const teamRec = teamMatchRecord.get(p.team_id) || { wins: 0, losses: 0 };
      const teamObj = p.teams as unknown as {
        divisions?: { name?: string; tournaments?: { title?: string } };
      };
      const divLabel = teamObj?.divisions?.name || 'Open';

      const key = pUserId || pName.toLowerCase();
      const existing = partnerMap.get(key) || {
        name: pName,
        userId: pUserId || null,
        divisions: new Set<string>(),
        wins: 0,
        losses: 0,
      };

      existing.divisions.add(divLabel);
      existing.wins += teamRec.wins;
      existing.losses += teamRec.losses;
      partnerMap.set(key, existing);
    }
  }

  // Resolve avatars for partners who have user accounts
  const partnerUserIds = Array.from(partnerMap.values())
    .map((p) => p.userId)
    .filter((id): id is string => Boolean(id));

  const avatarMap = new Map<string, string>();

  if (partnerUserIds.length > 0) {
    const { data: orgRows } = await supabaseAdmin
      .from('organizers')
      .select('user_id, avatar_url')
      .in('user_id', partnerUserIds);

    if (orgRows) {
      orgRows.forEach((o) => {
        if (o.avatar_url) avatarMap.set(o.user_id, o.avatar_url);
      });
    }

    try {
      const { data: authData } = await supabaseAdmin.auth.admin.listUsers();
      if (authData?.users) {
        for (const u of authData.users) {
          if (partnerUserIds.includes(u.id)) {
            const avatar = u.user_metadata?.avatar_url || u.user_metadata?.picture;
            if (avatar && !avatarMap.has(u.id)) {
              avatarMap.set(u.id, avatar);
            }
          }
        }
      }
    } catch {
      // Ignore auth admin listing failure
    }
  }

  const partners: PartnerStat[] = Array.from(partnerMap.values())
    .map((p) => {
      const total = p.wins + p.losses;
      const winPct = total > 0 ? Math.round((p.wins / total) * 100) : 0;
      const divSummary = Array.from(p.divisions).slice(0, 2).join(', ');
      const tournCount = p.divisions.size;
      const meta = `${divSummary} · ${tournCount} event${tournCount === 1 ? '' : 's'}`;
      const avatarUrl = (p.userId && avatarMap.get(p.userId)) || null;

      return {
        name: p.name,
        avatarUrl,
        meta,
        record: `${p.wins}–${p.losses}`,
        pct: `${winPct}%`,
        totalMatches: total,
      };
    })
    .filter((p) => p.totalMatches > 0)
    .sort((a, b) => b.totalMatches - a.totalMatches || parseInt(b.pct) - parseInt(a.pct))
    .slice(0, 5)
    .map(({ name, avatarUrl, meta, record, pct }) => ({
      name,
      avatarUrl,
      meta,
      record,
      pct,
    }));

  const stats: PlayerStatsResponse = {
    matchesCount,
    wins,
    losses,
    winRate,
    setsWon,
    setsLost,
    bestFinish: bestFinishText,
    longestStreak,
    partners,
  };

  return NextResponse.json({ stats });
}
