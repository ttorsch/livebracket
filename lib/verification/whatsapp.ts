import 'server-only';
import { ChannelUnavailableError, type SendCodeInput } from './channels';

/* ── WhatsApp: the seam, not yet the road ─────────────────────────
 *
 * The request below is the whole of the code required — one POST to
 * Meta's Cloud API. It is written out so that turning WhatsApp on is a
 * matter of setting two env vars, and so the shape of what is needed is
 * on the record rather than in someone's memory.
 *
 * IT HAS NEVER BEEN RUN AGAINST META. Do not treat it as working code
 * until someone has sent a real message through it. What stands between
 * here and that is account work, not engineering:
 *
 *   1. A Meta Business account that passes business verification. They
 *      ask for company documents and it takes days, sometimes longer.
 *   2. A phone number dedicated to the API. A number already registered
 *      on the consumer WhatsApp app cannot be used.
 *   3. An approved message template in the AUTHENTICATION category. Meta
 *      fixes the wording of these — the code goes in a copy-code button
 *      and you do not get to write your own sentence around it. Template
 *      approval is usually hours, and it is per-language.
 *
 * Authentication conversations are billed per message at a per-country
 * rate, so this channel is not free the way the email one effectively is.
 *
 * The template name and language are read from the environment because
 * they are whatever Meta approved, which is not something this file can
 * know. WHATSAPP_TEMPLATE_NAME must name an AUTHENTICATION template whose
 * body takes exactly one variable — the code.
 */

const GRAPH_VERSION = 'v21.0';

export async function sendWhatsAppCode({ destination, code }: SendCodeInput): Promise<void> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    throw new ChannelUnavailableError(
      'whatsapp',
      'WhatsApp is not configured. It needs a verified Meta Business account, a ' +
        'dedicated number, and an approved AUTHENTICATION template — see the notes ' +
        'in lib/verification/whatsapp.ts.',
    );
  }

  const template = process.env.WHATSAPP_TEMPLATE_NAME || 'verification_code';
  const language = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en';

  /* E.164 without the plus, which is what the Graph API wants. The stored
   * number is whatever a player typed into a registration form, so it is
   * normalised here rather than trusted. */
  const to = destination.replace(/\D/g, '');
  if (!to) throw new ChannelUnavailableError('whatsapp', 'No usable phone number for this team');

  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template,
        language: { code: language },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          /* An authentication template's copy-code button repeats the code
           * as its own parameter; Meta rejects the send without it. */
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error(`WhatsApp rejected the send (${response.status}): ${detail}`);
    throw new Error('Could not send the verification message');
  }
}
