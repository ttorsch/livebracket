import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  if (!slug) {
    return NextResponse.json({ error: 'Slug is required' }, { status: 400 });
  }

  try {
    // 1. Get tournament and its divisions, teams, and players with user_id
    const { data: tournament, error: tError } = await supabaseAdmin
      .from('tournaments')
      .select(`
        id,
        divisions (
          id,
          teams (
            id,
            registered_by,
            players ( id, user_id )
          )
        )
      `)
      .eq('slug', slug)
      .maybeSingle();

    if (tError || !tournament) {
      return NextResponse.json({ avatars: {} });
    }

    const avatars: Record<string, string> = {};
    const userIds = new Set<string>();

    for (const division of tournament.divisions || []) {
      for (const team of (division as any).teams || []) {
        if (team.registered_by) {
          userIds.add(team.registered_by);
        }
        for (const player of team.players || []) {
          if (player.user_id) {
            userIds.add(player.user_id);
          }
        }
      }
    }

    if (userIds.size === 0) {
      return NextResponse.json({ avatars: {} });
    }

    // 2. Resolve avatars from profiles table strictly by user_id
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, player_id, avatar_url')
      .in('id', Array.from(userIds))
      .not('avatar_url', 'is', null);

    if (profiles) {
      for (const p of profiles) {
        if (p.avatar_url) {
          avatars[p.id] = p.avatar_url;
          if (p.player_id) avatars[p.player_id] = p.avatar_url;
        }
      }
    }

    // 3. Fallback to auth.users user_metadata for missing user IDs
    const missingIds = Array.from(userIds).filter(id => !avatars[id]);
    for (const uId of missingIds) {
      try {
        const { data: uData } = await supabaseAdmin.auth.admin.getUserById(uId);
        if (uData?.user) {
          const avatarUrl =
            (uData.user.user_metadata?.avatar_url as string | undefined) ??
            (uData.user.user_metadata?.picture as string | undefined) ??
            null;
          if (avatarUrl) {
            avatars[uId] = avatarUrl;
          }
        }
      } catch {
        // Ignore single user lookup failure
      }
    }

    return NextResponse.json({ avatars });
  } catch (err) {
    return NextResponse.json(
      { avatars: {}, error: err instanceof Error ? err.message : 'Failed to fetch avatars' },
      { status: 500 }
    );
  }
}
