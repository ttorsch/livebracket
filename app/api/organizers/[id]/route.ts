import { NextResponse } from 'next/server';
import { getOrganizerCard } from '../../../../lib/organizerCard';

/* The card that opens when you click an organizer on a tournament card.
 *
 * Open to anonymous visitors on purpose, the same way /api/players/[id]
 * is: this opens from a public page, and everything it returns is already
 * on one. What is fit to show is decided in lib/organizerCard.ts, not
 * here — the route's only job is to refuse an id that is not one.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: 'Not an organizer id' }, { status: 400 });
  }

  try {
    const card = await getOrganizerCard(id);
    if (!card) return NextResponse.json({ error: 'Organizer not found' }, { status: 404 });
    return NextResponse.json({ card });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load organizer' },
      { status: 500 },
    );
  }
}
