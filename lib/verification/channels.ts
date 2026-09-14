import 'server-only';
import type { VerificationChannel } from './code';

/* ── Getting a code to a person ───────────────────────────────────
 *
 * One seam, two implementations, so the flow above it never learns which
 * channel it is using. Email ships today; WhatsApp is the reason this
 * file is a dispatch table rather than a call to Resend — see
 * ./whatsapp.ts for what is still missing there, none of which is code.
 *
 * Every sender takes a destination the *caller* read out of the database
 * and never one off the wire. That rule lives at the call site because it
 * is the call site that has the database row, but it is the rule that
 * keeps this from being a way to send mail from our domain to anywhere.
 */

export interface SendCodeInput {
  channel: VerificationChannel;
  destination: string;
  code: string;
  /** What the recipient is being asked to confirm, in their words. */
  context: {
    teamName: string;
    tournamentTitle: string;
    expiresInMinutes: number;
  };
}

export class ChannelUnavailableError extends Error {
  readonly channel: VerificationChannel;
  constructor(channel: VerificationChannel, message: string) {
    super(message);
    this.name = 'ChannelUnavailableError';
    this.channel = channel;
  }
}

export async function sendVerificationCode(input: SendCodeInput): Promise<void> {
  switch (input.channel) {
    case 'email': {
      const { sendEmailCode } = await import('./email');
      return sendEmailCode(input);
    }
    case 'whatsapp': {
      const { sendWhatsAppCode } = await import('./whatsapp');
      return sendWhatsAppCode(input);
    }
  }
}

/** Which channels this deployment can actually use right now. The UI reads
 *  it so it offers what works rather than what exists in the codebase. */
export function availableChannels(): VerificationChannel[] {
  const channels: VerificationChannel[] = [];
  if (process.env.RESEND_API_KEY) channels.push('email');
  if (process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
    channels.push('whatsapp');
  }
  return channels;
}
