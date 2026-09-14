import { NextRequest, NextResponse } from 'next/server';
import { resolveTeamEditAccess } from '../../../../../../lib/teamEditAccess';
import { issueCode, revokeCode, type VerificationChannel } from '../../../../../../lib/verification/code';
import { sendVerificationCode, ChannelUnavailableError, availableChannels } from '../../../../../../lib/verification/channels';
import { maskEmail, maskPhone } from '../../../../../../lib/verification/mask';

/* ── "It's my team" — step one ────────────────────────────────────
 *
 * Send a code to the address the team registered with. The caller names a
 * *channel*, never a destination: the destination is read out of the team
 * row here, which is the difference between a verification endpoint and a
 * way to send mail from our domain to an address of the sender's choosing.
 *
 * The response is the same whether or not a code went out, apart from the
 * honest `sent` flag. There is nothing to hide — the team is on a public
 * page — but there is also nothing to gain by narrating provider errors
 * to a visitor.
 */

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(request: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;

  const access = await resolveTeamEditAccess(teamId);
  if (!access) return bad('Team not found', 404);
  const { team } = access;

  if (team.tournament.cancelled) return bad('This tournament has been cancelled', 409);

  const body = (await request.json().catch(() => ({}))) as { channel?: string };
  const channel = body.channel === 'whatsapp' ? 'whatsapp' : 'email';

  if (!availableChannels().includes(channel as VerificationChannel)) {
    return bad(
      channel === 'whatsapp'
        ? 'WhatsApp codes are not switched on yet'
        : 'Email is not configured on this deployment',
      503,
    );
  }

  const destination = channel === 'email' ? team.contactEmail : team.contactPhone;
  if (!destination) {
    return bad(
      channel === 'email'
        ? 'This team has no contact email — ask the organizer to make the change'
        : 'This team has no contact number — ask the organizer to make the change',
      409,
    );
  }
  const hint = channel === 'email' ? maskEmail(destination) : maskPhone(destination);

  const issued = await issueCode('team_edit', teamId, channel, destination);
  if (!issued.ok) {
    return NextResponse.json(
      {
        sent: false,
        hint,
        reason: issued.reason,
        retryInSeconds: issued.retryInSeconds,
        error:
          issued.reason === 'cooldown'
            ? 'A code is already on its way — check for it before asking for another'
            : 'Too many codes requested. Try again later, or ask the organizer to make the change.',
      },
      { status: issued.reason === 'cooldown' ? 429 : 429 },
    );
  }

  try {
    await sendVerificationCode({
      channel,
      destination,
      code: issued.code,
      context: {
        teamName: team.teamName || team.name,
        tournamentTitle: team.tournament.title,
        expiresInMinutes: Math.round(issued.expiresInSeconds / 60),
      },
    });
  } catch (error) {
    /* Nothing was delivered, so nothing should be spendable — and the
     * next attempt must not be refused as a duplicate of a code that
     * never arrived. */
    await revokeCode('team_edit', teamId);
    if (error instanceof ChannelUnavailableError) {
      console.error(`Verification channel ${error.channel} unavailable:`, error.message);
      return bad('That way of confirming is not available right now', 503);
    }
    console.error('Failed to send verification code:', error);
    return bad('Could not send the code. Try again in a moment.', 502);
  }

  return NextResponse.json({ sent: true, hint, channel, expiresInSeconds: issued.expiresInSeconds });
}
