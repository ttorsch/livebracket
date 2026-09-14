import { NextRequest, NextResponse } from 'next/server';
import { resolveTeamEditAccess } from '../../../../../../lib/teamEditAccess';
import { confirmContactEmailChange } from '../../../../../../lib/teamEditContact';

/* Finish a contact-address move by proving the new address. Needs the
 * caller to still hold edit access on the team — the code alone is not
 * enough, or an address someone typed in by mistake could be confirmed by
 * whoever received the mail. */

export async function POST(request: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;

  const access = await resolveTeamEditAccess(teamId);
  if (!access) return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  if (!access.via) return NextResponse.json({ error: 'Confirm your team contact first' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const result = await confirmContactEmailChange(teamId, (body.code ?? '').trim());

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, attemptsLeft: result.attemptsLeft },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, contactEmail: result.email });
}
