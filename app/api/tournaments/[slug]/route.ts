import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { canDelete, type Phase } from '../../../../lib/tournamentLifecycle';
import { requireTournamentOwner } from '../../../../lib/auth';
import { authErrorResponse } from '../../../../lib/authResponse';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    // Owning this tournament is the permission; being signed in is not.
    await requireTournamentOwner(slug);
  } catch (err) {
    return authErrorResponse(err);
  }
  const body = await request.json();
  const { title, location, startDate, endDate, isOneDay, description, imageUrl } = body;

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
      // '' means the organizer removed the cover; store null rather than an
      // empty string so "no image" is one value everywhere.
      image_url: imageUrl !== undefined ? (imageUrl || null) : undefined,
    })
    .eq('slug', slug)
    .select('slug, title, location, start_date, end_date, is_one_day, phase, description, image_url')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    slug: data.slug,
    title: data.title,
    location: data.location,
    start_date: data.start_date,
    end_date: data.end_date,
    is_one_day: data.is_one_day,
    phase: data.phase,
    description: data.description,
    image_url: data.image_url,
  });
}

/* A draft has never been public and nobody has registered, so unlike
 * archive/cancel it just goes away — checked against the phase read here,
 * not trusted from the client, same reasoning as the status route.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    // Owning this tournament is the permission; being signed in is not.
    await requireTournamentOwner(slug);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { data: current, error: readError } = await supabaseAdmin
    .from('tournaments')
    .select('slug, phase')
    .eq('slug', slug)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });

  if (!canDelete(current.phase as Phase)) {
    return NextResponse.json(
      { error: 'Only a draft tournament can be deleted — archive or cancel it instead.' },
      { status: 409 },
    );
  }

  const { error } = await supabaseAdmin
    .from('tournaments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('slug', slug);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
