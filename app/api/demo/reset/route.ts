import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { resetDemoSandbox, getSandboxInfoForUser } from '@/lib/sandbox';

export const dynamic = 'force-dynamic';

/* Reset a demo sandbox back to the clean golden template state.
 *
 * Allows a prospective organizer who made experimental edits, broke their
 * bracket, or just wants a clean slate to restart instantly without waiting
 * for their 24-hour sandbox to expire. */
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const sandbox = await getSandboxInfoForUser(user.id);
    if (!sandbox) {
      return NextResponse.json(
        { error: 'This account is not a demo sandbox session' },
        { status: 403 }
      );
    }

    const clonedTournament = await resetDemoSandbox(user.id);

    return NextResponse.json({
      ok: true,
      message: 'Demo tournament successfully reset to golden template.',
      tournament: clonedTournament,
    });
  } catch (err: any) {
    console.error('Failed to reset demo sandbox:', err);
    return NextResponse.json(
      { error: 'Failed to reset demo tournament', message: err?.message },
      { status: 500 }
    );
  }
}
