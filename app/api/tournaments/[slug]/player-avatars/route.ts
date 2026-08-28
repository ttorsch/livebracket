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
    // 1. Get tournament and its divisions & teams
    const { data: tournament, error: tError } = await supabaseAdmin
      .from('tournaments')
      .select(`
        id,
        divisions (
          id,
          teams (
            id,
            name,
            registered_by,
            players ( id, name, email )
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
    const playerNames = new Set<string>();

    for (const division of tournament.divisions || []) {
      for (const team of (division as any).teams || []) {
        if (team.registered_by) {
          userIds.add(team.registered_by);
        }
        // Add names from team.name and players
        const teamParts = (team.name || '').split('/').map((s: string) => s.trim()).filter(Boolean);
        for (const p of teamParts) playerNames.add(p.toLowerCase());

        for (const player of team.players || []) {
          if (player.name) playerNames.add(player.name.trim().toLowerCase());
        }
      }
    }

    // 2. Resolve avatars from organizers table
    const { data: organizers } = await supabaseAdmin
      .from('organizers')
      .select('auth_user_id, name, avatar_url')
      .not('avatar_url', 'is', null);

    if (organizers) {
      for (const org of organizers) {
        if (!org.avatar_url) continue;
        if (org.auth_user_id) avatars[org.auth_user_id] = org.avatar_url;
        if (org.name) avatars[org.name.trim().toLowerCase()] = org.avatar_url;
      }
    }

    // 3. Resolve avatars from auth.users metadata
    try {
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 500 });
      if (usersData?.users) {
        for (const u of usersData.users) {
          const avatarUrl =
            (u.user_metadata?.avatar_url as string | undefined) ??
            (u.user_metadata?.picture as string | undefined) ??
            null;

          if (avatarUrl) {
            avatars[u.id] = avatarUrl;
            const name =
              (u.user_metadata?.full_name as string | undefined) ??
              (u.user_metadata?.name as string | undefined);
            if (name) avatars[name.trim().toLowerCase()] = avatarUrl;
          }
        }
      }
    } catch {
      // Ignore if listUsers is not permitted
    }

    return NextResponse.json({ avatars });
  } catch (err) {
    return NextResponse.json(
      { avatars: {}, error: err instanceof Error ? err.message : 'Failed to fetch avatars' },
      { status: 500 }
    );
  }
}
