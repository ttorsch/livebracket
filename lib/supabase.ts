import { createBrowserClient } from '@supabase/ssr';
import { type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY in your environment (e.g. Vercel project settings).'
    );
  }
  if (!client) {
    // createBrowserClient (rather than plain createClient) stores the session
    // in cookies instead of localStorage. That is the whole reason auth works
    // server-side at all: middleware, server components and route handlers
    // read the same cookie, so `getUser()` on the server sees the person who
    // signed in in the browser. Swapping this back to createClient silently
    // blinds every server-side auth check.
    client = createBrowserClient(supabaseUrl, supabaseAnonKey);
  }
  return client;
}

// Lazy proxy: the underlying client is only constructed on first property
// access (at runtime), so importing this module never throws during the
// production build / prerender when the env vars are absent.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const target = getSupabase();
    const value = Reflect.get(target, prop, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
