import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';
import { findByPlayerId, isPlayerId } from '../../../../lib/profiles';

/* The invite search: one exact player ID in, one player out.
 *
 * Three deliberate narrowings, because this is the only endpoint that
 * tells one account anything about another:
 *
 *  1. Exact 8-digit match only. No prefix, no name, no wildcard — so the
 *     endpoint cannot be walked to enumerate accounts. You have to have
 *     been given the number by the person it belongs to.
 *  2. Sign-in required. An anonymous visitor can still register a team by
 *     typing names; what they cannot do is probe who holds which ID.
 *  3. Name and avatar only. Enough to confirm you found the right
 *     teammate, and nothing that would make a guessed ID worth guessing.
 *
 * A miss is a plain 404 with the same shape as any other, so a caller
 * learns only "not this one" rather than anything about near misses. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to search for players' }, { status: 401 });
  }

  const playerId = request.nextUrl.searchParams.get('playerId')?.trim() ?? '';
  if (!isPlayerId(playerId)) {
    return NextResponse.json({ error: 'A player ID is 8 digits' }, { status: 400 });
  }

  try {
    const player = await findByPlayerId(playerId);
    if (!player) {
      return NextResponse.json({ error: 'No player with that ID' }, { status: 404 });
    }

    /* Finding yourself is not an error — the form uses it to fill your own
     * slot — but it is worth telling the UI so it can say so. */
    return NextResponse.json({ player, isSelf: player.userId === user.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lookup failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
