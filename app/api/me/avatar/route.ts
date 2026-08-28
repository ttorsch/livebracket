import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getCurrentUser } from '@/lib/auth';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'File is required' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Only PNG, JPEG, WebP, or GIF images are allowed' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Image must be 5MB or smaller' }, { status: 400 });
  }

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : file.type === 'image/gif' ? 'gif' : 'jpg';
  const path = `avatars/${user.id}-${Date.now()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  // Try tournament-images bucket first, fallback to avatars bucket
  let uploadError = null;
  const { error: tError } = await supabaseAdmin.storage
    .from('tournament-images')
    .upload(path, bytes, { contentType: file.type, upsert: true });

  if (!tError) {
    const { data } = supabaseAdmin.storage.from('tournament-images').getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl }, { status: 201 });
  }

  uploadError = tError;

  const { error: aError } = await supabaseAdmin.storage
    .from('avatars')
    .upload(path, bytes, { contentType: file.type, upsert: true });

  if (!aError) {
    const { data } = supabaseAdmin.storage.from('avatars').getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl }, { status: 201 });
  }

  return NextResponse.json({ error: uploadError.message || aError.message }, { status: 500 });
}
