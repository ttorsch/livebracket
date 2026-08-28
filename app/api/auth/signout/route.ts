import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '../../../../lib/supabaseServer';

/* Signing out has to happen server-side so the auth cookie is actually
 * cleared. A browser-only signOut() leaves the cookie for middleware and
 * server components to keep honouring. */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
