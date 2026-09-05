import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';
import { getPlayerCard } from '../../../../lib/playerCard';

/* The card that opens when you click a player's name.
 *
 * Addressed by account id, not by the 8-digit player ID: that number is
 * the key to inviting someone onto a team, and putting it in the URLs a
 * public page links to would be handing it out. See lib/playerCard.ts for
 * what each kind of viewer is shown.
 *
 * Open to anonymous visitors on purpose — the tournament page this opens
 * from is public, and so is everything an anonymous caller gets back.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  if (!UUID.test(userId)) {
    return NextResponse.json({ error: 'Not a player id' }, { status: 400 });
  }

  const viewer = await getCurrentUser();
  const recentLimit = Number(request.nextUrl.searchParams.get('recent') ?? 0);

  try {
    const card = await getPlayerCard(userId, {
      includePrivate: !!viewer,
      viewerId: viewer?.id ?? null,
      recentLimit: Number.isFinite(recentLimit) ? Math.min(20, Math.max(0, recentLimit)) : 0,
    });
    if (!card) {
      return NextResponse.json({ error: 'No player found' }, { status: 404 });
    }
    return NextResponse.json({ card, viewerSignedIn: !!viewer, isSelf: viewer?.id === userId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Lookup failed' },
      { status: 500 }
    );
  }
}
