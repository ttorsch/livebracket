import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getSessionInfo } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { ensureProfileForUser } from '@/lib/profiles';

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    const avatarUrl = typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() : undefined;
    const club = typeof body.club === 'string' ? body.club.trim() : undefined;
    const hometown = typeof body.hometown === 'string' ? body.hometown.trim() : undefined;

    const userMetadataUpdate: Record<string, any> = {
      ...(user.user_metadata || {}),
    };

    if (name !== undefined) {
      userMetadataUpdate.full_name = name;
      userMetadataUpdate.name = name;
    }
    if (avatarUrl !== undefined) {
      userMetadataUpdate.avatar_url = avatarUrl;
      userMetadataUpdate.picture = avatarUrl;
    }
    if (club !== undefined) {
      userMetadataUpdate.club = club;
    }
    if (hometown !== undefined) {
      userMetadataUpdate.hometown = hometown;
      userMetadataUpdate.location = hometown;
    }

    // Update Supabase auth user metadata
    const { error: userError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: userMetadataUpdate,
    });

    if (userError) {
      return NextResponse.json({ error: userError.message }, { status: 500 });
    }

    /* Deliberately does NOT touch the organizers row. This endpoint edits
     * the PLAYER profile, and the organizer profile is a separate identity
     * with its own editor (PATCH /api/organizer) — the same account can be
     * both, and changing your name on a roster must not rename the person
     * running the event on every public page. */

    /* The profiles row is what getSessionInfo reads first, so an edit that
     * only reached user_metadata would appear to do nothing. Written last
     * and by id — player_id is never touched here, because an id the owner
     * can rewrite is an id someone else's invite can follow. */
    await ensureProfileForUser(user);
    const profileUpdate: Record<string, string> = {};
    if (name !== undefined) profileUpdate.name = name;
    if (avatarUrl !== undefined) profileUpdate.avatar_url = avatarUrl;
    if (club !== undefined) profileUpdate.club = club;
    if (hometown !== undefined) profileUpdate.hometown = hometown;

    if (Object.keys(profileUpdate).length > 0) {
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .update({ ...profileUpdate, updated_at: new Date().toISOString() })
        .eq('id', user.id);
      if (profileError) {
        return NextResponse.json({ error: profileError.message }, { status: 500 });
      }
    }

    const session = await getSessionInfo();
    return NextResponse.json({ session });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update profile' },
      { status: 500 }
    );
  }
}
