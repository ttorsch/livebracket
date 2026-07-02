import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await request.json();
  const { title, location, startDate, endDate, isOneDay, description } = body;

  if (!title || !location || !startDate) {
    return NextResponse.json({ error: 'title, location, and startDate are required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('tournaments')
    .update({
      title,
      location,
      start_date: startDate,
      end_date: isOneDay ? startDate : (endDate || null),
      is_one_day: !!isOneDay,
      description: description || null,
    })
    .eq('slug', slug)
    .select('slug, title, location, start_date, end_date, is_one_day, phase, description')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
