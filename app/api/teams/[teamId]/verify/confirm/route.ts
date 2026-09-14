import { NextRequest, NextResponse } from 'next/server';
import { loadTeamForEdit, TEAM_EDIT_COOKIE } from '../../../../../../lib/teamEditAccess';
import { confirmCode, createVerifiedSession } from '../../../../../../lib/verification/code';

/* ── "It's my team" — step two ────────────────────────────────────
 *
 * Spend the code, and hand back a cookie that stands in for it for the
 * next half hour. The cookie carries an opaque token and nothing else:
 * what it means is looked up server-side every time, so it cannot be
 * edited into a claim on a different team.
 */

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(request: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;

  const loaded = await loadTeamForEdit(teamId);
  if (!loaded) return bad('Team not found', 404);

  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const submitted = (body.code ?? '').trim();
  if (!submitted) return bad('Enter the code');

  const result = await confirmCode('team_edit', teamId, submitted);
  if (!result.ok) {
    if (result.reason === 'expired') return bad('That code expired — ask for a new one', 410);
    if (result.reason === 'no_attempts_left') return bad('Too many wrong codes — ask for a new one', 429);
    return NextResponse.json(
      { error: 'That code is not right', attemptsLeft: result.attemptsLeft },
      { status: 400 },
    );
  }

  const { token, expiresInSeconds } = await createVerifiedSession({
    purpose: 'team_edit',
    subjectId: teamId,
    channel: result.channel,
    destination: result.destination,
  });

  const response = NextResponse.json({ ok: true, expiresInSeconds });
  response.cookies.set(TEAM_EDIT_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: expiresInSeconds,
  });
  return response;
}
