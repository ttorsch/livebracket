import 'server-only';

/* ── Does this address already have an account? ───────────────────
 *
 * Asked in exactly one place: the team-edit flow, immediately after
 * someone has typed back a code we mailed to the address in question.
 *
 * Normally an endpoint that answers this is a user-enumeration oracle and
 * should not exist. It is safe *here*, and only here, because of what has
 * to be true before it can be called: the caller has already proved they
 * control the inbox. They could learn the same fact from any password
 * reset form. Nothing below may ever be reachable without that proof —
 * see the session check in the route that calls it.
 *
 * The alternative was to find out by attempting to create the account and
 * reading the failure, which is what this replaces. That worked, but it
 * made the person choose a password and press Create before being told
 * they already had an account and never needed one.
 *
 * GoTrue's admin list endpoint is used rather than supabase-js, whose
 * `listUsers` takes only page params — scanning every user to answer a
 * question about one is the wrong shape. `filter` is a fuzzy match, so
 * the address is compared exactly afterwards rather than trusted.
 */

export interface AccountLookup {
  exists: boolean;
  /** 'email' means a password exists. Anything else is OAuth-only, and
   *  asking such a person for a password is a dead end. */
  providers: string[];
}

const NONE: AccountLookup = { exists: false, providers: [] };

export async function findAccountByEmail(email: string): Promise<AccountLookup> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return NONE;

  const wanted = email.trim().toLowerCase();
  if (!wanted) return NONE;

  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  try {
    const res = await fetch(
      `${base}/auth/v1/admin/users?filter=${encodeURIComponent(wanted)}&per_page=20`,
      { headers, cache: 'no-store' },
    );
    if (!res.ok) return NONE;

    const body = (await res.json()) as { users?: { id: string; email?: string | null }[] };
    const match = (body.users ?? []).find((u) => u.email?.trim().toLowerCase() === wanted);
    if (!match) return NONE;

    /* The list response carries no identities, so the providers need the
     * single-user read. A failure here is not a failure of the lookup:
     * the account exists either way, and an empty provider list simply
     * means the UI offers its password field, which is the old behaviour. */
    const detail = await fetch(`${base}/auth/v1/admin/users/${match.id}`, { headers, cache: 'no-store' });
    if (!detail.ok) return { exists: true, providers: [] };

    const user = (await detail.json()) as {
      identities?: { provider?: string }[];
      app_metadata?: { providers?: string[] };
    };
    const providers =
      user.identities?.map((i) => i.provider).filter((p): p is string => !!p) ??
      user.app_metadata?.providers ??
      [];

    return { exists: true, providers: [...new Set(providers)] };
  } catch (error) {
    /* Never fatal. Not knowing means the flow offers account creation and
     * finds out the hard way at submit — the behaviour this replaced, kept
     * as the fallback it always was. */
    console.error('Account lookup failed:', error);
    return NONE;
  }
}
