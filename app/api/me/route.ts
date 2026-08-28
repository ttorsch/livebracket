import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getOrganizerForUser, getSessionInfo } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

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

    // If this user is also an organizer, sync the organizers table
    const organizer = await getOrganizerForUser(user.id);
    if (organizer) {
      const orgUpdate: Record<string, any> = {};
      if (name !== undefined) orgUpdate.name = name;
      if (avatarUrl !== undefined) orgUpdate.avatar_url = avatarUrl;
      if (club !== undefined) orgUpdate.club = club;
      if (hometown !== undefined) orgUpdate.hometown = hometown;

      if (Object.keys(orgUpdate).length > 0) {
        await supabaseAdmin
          .from('organizers')
          .update(orgUpdate)
          .eq('id', organizer.id);
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
