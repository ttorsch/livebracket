/* ── Saying which address without saying the address ──────────────
 *
 * The team edit flow has to tell a visitor where the code went, so they
 * know which inbox to open. It must not tell them the contact address,
 * which belongs to the team and not to whoever clicked.
 *
 * No `server-only` here: the client renders these and never derives them,
 * so the shape is shared the same way lib/session.ts is.
 */

/** `t••••@gmail.com` — enough to recognise, not enough to type. */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return '••••';
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const head = local.slice(0, 1);
  return `${head}${'•'.repeat(Math.max(3, Math.min(local.length - 1, 6)))}@${domain}`;
}

/** `••• ••• 4821` — the last four, which is what people check against. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return `••• ••• ${digits.slice(-4)}`;
}
