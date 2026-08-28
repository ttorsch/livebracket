import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { type SupabaseClient } from '@supabase/supabase-js';

/* The request-scoped Supabase client for server components, route handlers
 * and server actions. It reads the same auth cookie the browser client
 * writes (see lib/supabase.ts), so `getUser()` here returns the person who
 * actually signed in — unlike lib/supabaseAdmin.ts, which is unauthenticated
 * service-role access that bypasses RLS entirely.
 *
 * Must be constructed per request, never cached in a module-level variable:
 * one cached client would leak one visitor's session to the next. */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY in your environment.'
    );
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          /* Server components cannot set cookies. That is fine and expected:
           * middleware.ts already refreshed the session for this request, so
           * the only thing lost here is a duplicate write. */
        }
      },
    },
  });
}
