import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { slugify } from '../../../lib/slug';

// Single demo organizer until real auth exists — matches how the rest of
// the app (dashboard, seed data) treats one organizer today.
const DEMO_ORGANIZER_ID = '00000000-0000-0000-0001-000000000001';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { title, location, startDate, endDate, isOneDay, description, imageUrl } = body;

  if (!title || !location || !startDate) {
    return NextResponse.json({ error: 'title, location, and startDate are required' }, { status: 400 });
  }

  const baseSlug = slugify(title);
  let slug = baseSlug;

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabaseAdmin
      .from('tournaments')
      .insert({
        slug,
        organizer_id: DEMO_ORGANIZER_ID,
        title,
        location,
        start_date: startDate,
        end_date: isOneDay ? startDate : (endDate || null),
        is_one_day: !!isOneDay,
        phase: 1,
        description: description || null,
        image_url: imageUrl || null,
      })
      .select('slug')
      .single();

    if (!error) return NextResponse.json({ slug: data.slug }, { status: 201 });

    if (error.code === '23505') {
      // slug collision — try again with a numeric suffix
      slug = `${baseSlug}-${attempt + 1}`;
      continue;
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ error: 'Could not generate a unique slug' }, { status: 500 });
}
