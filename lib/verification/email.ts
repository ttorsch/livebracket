import 'server-only';
import { ChannelUnavailableError, type SendCodeInput } from './channels';

/* Resend's REST API, called with fetch rather than through their SDK.
 *
 * One POST with a bearer token is not worth a dependency, and keeping the
 * call here means the whole provider surface this app uses is the twenty
 * lines below — swapping providers is rewriting this file and nothing
 * else.
 *
 * RESEND_API_KEY arrives from the Vercel Marketplace integration. The from
 * address must be on a domain verified in Resend (DKIM + SPF records at
 * the DNS provider), or Resend rejects the send with a 403.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const DEFAULT_FROM = 'Live Bracket <noreply@livebracket.khaolakvolley.com>';

export async function sendEmailCode({ destination, code, context }: SendCodeInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new ChannelUnavailableError(
      'email',
      'Email is not configured. Set RESEND_API_KEY (Vercel Marketplace → Resend).',
    );
  }

  const from = process.env.TEAM_EDIT_FROM_EMAIL || DEFAULT_FROM;
  const { teamName, tournamentTitle, expiresInMinutes } = context;

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [destination],
      subject: `${code} is your Live Bracket code`,
      text: textBody(code, teamName, tournamentTitle, expiresInMinutes),
      html: htmlBody(code, teamName, tournamentTitle, expiresInMinutes),
    }),
  });

  if (!response.ok) {
    /* Resend's body carries the real reason (unverified domain, invalid
     * recipient). Logged rather than returned: the caller must not leak
     * provider detail to a visitor who only typed a team's name. */
    const detail = await response.text().catch(() => '');
    console.error(`Resend rejected the send (${response.status}): ${detail}`);
    throw new Error('Could not send the verification email');
  }
}

const textBody = (code: string, team: string, tournament: string, minutes: number) =>
  [
    `Your code is ${code}`,
    '',
    `Someone asked to edit ${team}'s details for ${tournament}.`,
    `Enter this code to confirm it was you. It expires in ${minutes} minutes.`,
    '',
    "If this wasn't you, ignore this email — nothing changes without the code.",
  ].join('\n');

/* Deliberately plain HTML with inline styles: mail clients strip
 * stylesheets, and a verification mail has one job. */
const htmlBody = (code: string, team: string, tournament: string, minutes: number) => `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111">
  <p style="margin:0 0 24px;font-size:15px;line-height:1.5">
    Someone asked to edit <strong>${escapeHtml(team)}</strong>'s details for
    <strong>${escapeHtml(tournament)}</strong>. Enter this code to confirm it was you:
  </p>
  <div style="font-size:34px;font-weight:700;letter-spacing:9px;text-align:center;padding:20px;background:#f4f4f5;border-radius:12px">
    ${escapeHtml(code)}
  </div>
  <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#666">
    The code expires in ${minutes} minutes. If this wasn't you, ignore this email —
    nothing changes without the code.
  </p>
</div>`;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
