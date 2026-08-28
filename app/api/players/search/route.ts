import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { toPlayerId } from '@/lib/playerId';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const idQuery = searchParams.get('id')?.trim() || '';
  const textQuery = searchParams.get('q')?.trim().toLowerCase() || '';

  if (!idQuery && !textQuery) {
    return NextResponse.json({ error: 'Provide a player ID or search query' }, { status: 400 });
  }

  try {
    const { data: usersData, error: uError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    if (uError) {
      return NextResponse.json({ error: uError.message }, { status: 500 });
    }

    const { data: organizers } = await supabaseAdmin
      .from('organizers')
      .select('auth_user_id, name, club, avatar_url');

    const orgMap = new Map<string, { name?: string; club?: string | null; avatar_url?: string | null }>();
    if (organizers) {
      for (const org of organizers) {
        if (org.auth_user_id) orgMap.set(org.auth_user_id, org);
      }
    }

    const users = usersData?.users || [];
    let matchedUser = null;

    for (const u of users) {
      const pId = toPlayerId(u.id);
      if (idQuery && (pId === idQuery || u.id === idQuery)) {
        matchedUser = u;
        break;
      }
      if (textQuery) {
        const name = (
          (u.user_metadata?.full_name as string | undefined) ??
          (u.user_metadata?.name as string | undefined) ??
          ''
        ).toLowerCase();
        const email = (u.email || '').toLowerCase();
        if (name.includes(textQuery) || email.includes(textQuery) || pId.includes(textQuery)) {
          matchedUser = u;
          break;
        }
      }
    }

    if (!matchedUser) {
      return NextResponse.json({ player: null, message: 'Player not found' }, { status: 404 });
    }

    const org = orgMap.get(matchedUser.id);
    const player = {
      playerId: toPlayerId(matchedUser.id),
      userId: matchedUser.id,
      name:
        org?.name ??
        (matchedUser.user_metadata?.full_name as string | undefined) ??
        (matchedUser.user_metadata?.name as string | undefined) ??
        matchedUser.email?.split('@')[0] ??
        '',
      club:
        org?.club ??
        (matchedUser.user_metadata?.club as string | undefined) ??
        '',
      hometown:
        (matchedUser.user_metadata?.hometown as string | undefined) ??
        (matchedUser.user_metadata?.location as string | undefined) ??
        '',
      nationality:
        (matchedUser.user_metadata?.nationality as string | undefined) ??
        '',
      shirtSize:
        (matchedUser.user_metadata?.shirt_size as string | undefined) ??
        (matchedUser.user_metadata?.shirtSize as string | undefined) ??
        '',
      avatarUrl:
        org?.avatar_url ??
        (matchedUser.user_metadata?.avatar_url as string | undefined) ??
        (matchedUser.user_metadata?.picture as string | undefined) ??
        null,
    };

    return NextResponse.json({ player });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to search player' },
      { status: 500 }
    );
  }
}
