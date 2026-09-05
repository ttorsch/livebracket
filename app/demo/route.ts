import { NextResponse, type NextRequest } from 'next/server';
import { createDemoSandbox } from '@/lib/sandbox';

export const dynamic = 'force-dynamic';

/* The instant try-it-yourself demo entry point.
 *
 * A visitor opens /demo (from the hero banner, outreach link, or marketing pitch).
 * The route:
 *  1. Mints a private sandbox session (24h expiry)
 *  2. Creates a throwaway organizer account
 *  3. Clones the full-featured golden template tournament (~150 rows)
 *  4. Signs the visitor in via server auth cookies
 *  5. Redirects immediately to /dashboard
 *
 * No email, no password prompt, no waiting. */
export async function GET(request: NextRequest) {
  try {
    const { searchParams, origin } = request.nextUrl;
    const nextParam = searchParams.get('next');

    const { clonedTournament } = await createDemoSandbox();

    // Default destination is the organizer dashboard where they can see and manage their sandbox
    let destination = '/dashboard';
    if (nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//')) {
      destination = nextParam;
    }

    return NextResponse.redirect(`${origin}${destination}`);
  } catch (err: any) {
    console.error('Failed to create demo sandbox:', err);
    return NextResponse.json(
      {
        error: 'Failed to launch demo sandbox',
        message: err?.message || 'Unknown error occurred while cloning golden template.',
      },
      { status: 500 }
    );
  }
}
