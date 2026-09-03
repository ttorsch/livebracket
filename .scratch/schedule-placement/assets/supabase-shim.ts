/* Stands in for lib/supabase.ts when a repro harness runs under plain node.
 * Same table reads, plain server client instead of the cookie-backed browser
 * one — which cannot load outside a browser. Read-only by use, not by grant. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
export const supabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
