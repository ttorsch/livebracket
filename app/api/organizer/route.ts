import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

// Single demo organizer until real auth exists — matches app/api/tournaments/route.ts.
const DEMO_ORGANIZER_ID = '00000000-0000-0000-0001-000000000001';

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('organizers')
    .select('name, club, avatar_url')
    .eq('id', DEMO_ORGANIZER_ID)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
