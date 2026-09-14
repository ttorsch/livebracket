import 'server-only';
import { redis } from './redis';
import { supabaseAdmin } from './supabaseAdmin';
import { issueCode, confirmCode, VERIFICATION_LIMITS } from './verification/code';
import { sendVerificationCode } from './verification/channels';
import { maskEmail } from './verification/mask';
import type { TeamEditTarget } from './teamEditAccess';

/* ── Moving a team's contact address ──────────────────────────────
 *
 * Every other field on a team is just data. This one decides who can get
 * back in to change the rest of it, so it is the one change that is not
 * finished when Save is pressed: the new address has to answer a code
 * before it becomes the team's.
 *
 * Without that, holding one code long enough to open the form would be
 * enough to point the team at your own inbox and keep it — the address
 * that let you in would no longer be the address that lets anyone else
 * in. Confirming at the destination makes taking the team over require
 * access to the inbox you are moving it to, which is the same bar the
 * original registration cleared.
 *
 * The pending value lives in Redis beside the code and expires with it. A
 * change nobody confirms simply never happened, which is the right
 * outcome and needs no cleanup.
 */

const pendingKey = (teamId: string) => `teamEdit:pendingEmail:${teamId}`;

export async function stashPendingEmail(teamId: string, email: string): Promise<void> {
  await redis.set(pendingKey(teamId), email, { ex: VERIFICATION_LIMITS.codeTtlSeconds });
}

export async function readPendingEmail(teamId: string): Promise<string | null> {
  return (await redis.get<string>(pendingKey(teamId))) ?? null;
}

/** Issue and send the code that would move this team's contact address.
 *  `sent: false` means the code exists but the mail did not go — the caller
 *  shows that rather than claiming a delivery that did not happen. */
export async function startContactEmailChange(
  team: TeamEditTarget,
  newEmail: string,
): Promise<{ hint: string; sent: boolean }> {
  const issued = await issueCode('team_contact_email', team.id, 'email', newEmail);
  const hint = maskEmail(newEmail);

  /* A cooldown or a rate limit is not an error here: an address already
   * holding a live code does not need a second one. */
  if (!issued.ok) return { hint, sent: false };

  await stashPendingEmail(team.id, newEmail);

  try {
    await sendVerificationCode({
      channel: 'email',
      destination: newEmail,
      code: issued.code,
      context: {
        teamName: team.teamName || team.name,
        tournamentTitle: team.tournament.title,
        expiresInMinutes: Math.round(issued.expiresInSeconds / 60),
      },
    });
    return { hint, sent: true };
  } catch (error) {
    console.error('Failed to send contact-email change code:', error);
    return { hint, sent: false };
  }
}

export type ConfirmEmailResult =
  | { ok: true; email: string }
  | { ok: false; error: string; attemptsLeft?: number };

export async function confirmContactEmailChange(teamId: string, code: string): Promise<ConfirmEmailResult> {
  const pending = await readPendingEmail(teamId);
  if (!pending) return { ok: false, error: 'That request expired — save the new address again' };

  const result = await confirmCode('team_contact_email', teamId, code);
  if (!result.ok) {
    if (result.reason === 'expired') return { ok: false, error: 'That code expired — save the new address again' };
    if (result.reason === 'no_attempts_left') {
      return { ok: false, error: 'Too many wrong codes — save the new address again' };
    }
    return { ok: false, error: 'That code is not right', attemptsLeft: result.attemptsLeft };
  }

  const { error } = await supabaseAdmin.from('teams').update({ contact_email: pending }).eq('id', teamId);
  if (error) return { ok: false, error: error.message };

  await redis.del(pendingKey(teamId));
  return { ok: true, email: pending };
}
