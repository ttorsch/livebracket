import 'server-only';
import { createHash, randomInt, randomBytes, timingSafeEqual } from 'node:crypto';
import { redis } from '../redis';

/* ── One-time codes ───────────────────────────────────────────────
 *
 * A six-digit code, sent to an address the *server* already holds, that
 * buys a short-lived right to change one thing. Used by the team edit
 * flow so a player with no account can still correct their own roster.
 *
 * Redis rather than Postgres, for the same reason live scores are: every
 * one of these rows is garbage within ten minutes, and a TTL is a better
 * expiry than a sweeper job. It is also already in the stack — see
 * lib/scorekeeper.ts, which stores its tokens the same way.
 *
 * Three rules, none of them optional:
 *
 *   1. The code is stored as a hash. Whoever can read the Redis database
 *      can then still not sign anything, which is the whole point of not
 *      storing the plaintext of a credential.
 *   2. A code dies after MAX_ATTEMPTS wrong guesses. Six digits is a
 *      million possibilities; without this it is a few thousand requests.
 *   3. Sending is rate limited *per subject*, so the endpoint cannot be
 *      turned into a way to mail someone repeatedly.
 *
 * The destination is never taken from the caller — `issueCode` is handed
 * one the server read out of the database. A route that let the client
 * name the recipient would be an open relay with our domain on it.
 */

export type VerificationChannel = 'email' | 'whatsapp';

/** What a code is *for*. Part of the key, so a code issued for one
 *  purpose can never be spent on another — which is what stops a code
 *  mailed to a team's existing address being spent on approving a move to
 *  a different one. */
export type VerificationPurpose = 'team_edit' | 'team_contact_email';

const CODE_TTL_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 5;
/** Sends allowed per subject per RATE_WINDOW_SECONDS. */
const MAX_SENDS = 5;
const RATE_WINDOW_SECONDS = 60 * 60;
/** How long before a new code can replace an unspent one. */
const RESEND_COOLDOWN_SECONDS = 60;

const codeKey = (purpose: VerificationPurpose, subjectId: string) =>
  `verify:code:${purpose}:${subjectId}`;
const rateKey = (purpose: VerificationPurpose, subjectId: string) =>
  `verify:rate:${purpose}:${subjectId}`;

interface StoredCode {
  /** sha256 of the digits. Never the digits. */
  hash: string;
  channel: VerificationChannel;
  destination: string;
  attempts: number;
  issuedAt: number;
}

const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');

/* Constant-time compare of two hex digests. Both are fixed-length hex, so
 * the length guard below only ever trips on a malformed stored value. */
function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/** Six digits, leading zeros kept — `randomInt` rather than Math.random
 *  because this is a credential. */
const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

export type IssueResult =
  | { ok: true; code: string; expiresInSeconds: number }
  | { ok: false; reason: 'cooldown' | 'rate_limited'; retryInSeconds: number };

/* Mint a code for one subject, or refuse to.
 *
 * Refusing is a normal outcome and the caller is expected to show it:
 * `cooldown` means "your code is still good, check your mail", which is a
 * far better answer than silently sending a second one. */
export async function issueCode(
  purpose: VerificationPurpose,
  subjectId: string,
  channel: VerificationChannel,
  destination: string,
): Promise<IssueResult> {
  const existing = await redis.get<StoredCode>(codeKey(purpose, subjectId));
  if (existing) {
    const age = (Date.now() - existing.issuedAt) / 1000;
    if (age < RESEND_COOLDOWN_SECONDS) {
      return { ok: false, reason: 'cooldown', retryInSeconds: Math.ceil(RESEND_COOLDOWN_SECONDS - age) };
    }
  }

  /* Counted on every send including the first, so the window is the last
   * hour rather than the hour after the first send. */
  const sends = await redis.incr(rateKey(purpose, subjectId));
  if (sends === 1) await redis.expire(rateKey(purpose, subjectId), RATE_WINDOW_SECONDS);
  if (sends > MAX_SENDS) {
    const ttl = await redis.ttl(rateKey(purpose, subjectId));
    return { ok: false, reason: 'rate_limited', retryInSeconds: ttl > 0 ? ttl : RATE_WINDOW_SECONDS };
  }

  const code = newCode();
  const record: StoredCode = {
    hash: hashCode(code),
    channel,
    destination,
    attempts: 0,
    issuedAt: Date.now(),
  };
  await redis.set(codeKey(purpose, subjectId), record, { ex: CODE_TTL_SECONDS });

  return { ok: true, code, expiresInSeconds: CODE_TTL_SECONDS };
}

/* Throw away a code that was minted but never actually sent.
 *
 * Issuing and delivering are two steps, and the second one can fail — a
 * provider outage, an unverified domain. Without this the visitor is held
 * to the resend cooldown for a code that is not in anyone's inbox, so the
 * only thing they can do about a transient failure is wait a minute. The
 * rate-limit counter is deliberately *not* rolled back: a caller failing
 * repeatedly should still run out of attempts. */
export async function revokeCode(
  purpose: VerificationPurpose,
  subjectId: string,
): Promise<void> {
  await redis.del(codeKey(purpose, subjectId));
}

export type ConfirmResult =
  | { ok: true; channel: VerificationChannel; destination: string }
  | { ok: false; reason: 'expired' | 'no_attempts_left' | 'wrong_code'; attemptsLeft: number };

/* Spend a code. Correct codes are deleted on use — a code is one-time in
 * both directions, so a replayed request cannot mint a second session. */
export async function confirmCode(
  purpose: VerificationPurpose,
  subjectId: string,
  submitted: string,
): Promise<ConfirmResult> {
  const key = codeKey(purpose, subjectId);
  const record = await redis.get<StoredCode>(key);
  if (!record) return { ok: false, reason: 'expired', attemptsLeft: 0 };

  if (record.attempts >= MAX_ATTEMPTS) {
    await redis.del(key);
    return { ok: false, reason: 'no_attempts_left', attemptsLeft: 0 };
  }

  const cleaned = submitted.replace(/\D/g, '');
  if (cleaned.length === 6 && hashesMatch(hashCode(cleaned), record.hash)) {
    await redis.del(key);
    return { ok: true, channel: record.channel, destination: record.destination };
  }

  /* keepTtl: a wrong guess must not extend the code's life. */
  const attempts = record.attempts + 1;
  await redis.set(key, { ...record, attempts }, { keepTtl: true });
  const attemptsLeft = MAX_ATTEMPTS - attempts;
  if (attemptsLeft <= 0) {
    await redis.del(key);
    return { ok: false, reason: 'no_attempts_left', attemptsLeft: 0 };
  }
  return { ok: false, reason: 'wrong_code', attemptsLeft };
}

/* ── The right a spent code buys ──────────────────────────────────
 *
 * An opaque token in an httpOnly cookie, resolved against Redis on every
 * request. The cookie names a session; it never *is* one, so revoking is
 * a delete here rather than something the browser has to cooperate with.
 */

const SESSION_TTL_SECONDS = 30 * 60;
const sessionKey = (token: string) => `verify:session:${token}`;

export interface VerifiedSession {
  purpose: VerificationPurpose;
  subjectId: string;
  channel: VerificationChannel;
  destination: string;
  createdAt: number;
}

export async function createVerifiedSession(session: Omit<VerifiedSession, 'createdAt'>) {
  const token = randomBytes(32).toString('base64url');
  const record: VerifiedSession = { ...session, createdAt: Date.now() };
  await redis.set(sessionKey(token), record, { ex: SESSION_TTL_SECONDS });
  return { token, expiresInSeconds: SESSION_TTL_SECONDS };
}

export async function readVerifiedSession(token: string | undefined | null): Promise<VerifiedSession | null> {
  if (!token) return null;
  return (await redis.get<VerifiedSession>(sessionKey(token))) ?? null;
}

export async function revokeVerifiedSession(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await redis.del(sessionKey(token));
}

export const VERIFICATION_LIMITS = {
  codeTtlSeconds: CODE_TTL_SECONDS,
  maxAttempts: MAX_ATTEMPTS,
  sessionTtlSeconds: SESSION_TTL_SECONDS,
  resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
} as const;
