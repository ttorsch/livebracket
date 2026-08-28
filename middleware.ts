import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { signInDestination } from './lib/authRedirect';

/* Routes only a signed-in user may open. Anything not listed here stays
 * public — the tournament pages, the score-keeper screens (which carry
 * their own token) and the homepage must keep working for anonymous
 * visitors. */
const PROTECTED_PREFIXES = ['/dashboard', '/profile'];

/* Routes that make no sense once you are already signed in. */
const AUTH_ONLY_PREFIXES = ['/login', '/forgot-password'];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isAuthOnly(pathname: string): boolean {
  return AUTH_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  /* Without Supabase configured there is no session to speak of. Failing
   * open here keeps local/preview builds that lack env vars usable rather
   * than locking every page behind a login that cannot work. */
  if (!supabaseUrl || !supabaseAnonKey) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  /* This call is the point of the middleware even on public routes: it
   * refreshes an expiring access token and writes the rotated cookie onto
   * `response`. Skip it and sessions quietly die after an hour. */
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && isProtected(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    // Remember where they were headed so the login can finish the journey,
    // and open the tab that matches it — someone bounced off /dashboard is
    // an organizer, someone bounced off /profile is a player.
    loginUrl.searchParams.set('next', `${pathname}${search}`);
    loginUrl.searchParams.set('role', pathname.startsWith('/profile') ? 'player' : 'organizer');
    return NextResponse.redirect(loginUrl);
  }

  if (user && isAuthOnly(pathname)) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.search = '';

    /* Already signed in and landing on the login form — usually from a
     * "Sign in" control they did not need. The same rule the login form
     * uses decides where they go: a player resumes the page they were on,
     * an organizer gets their dashboard rather than whatever public page
     * the link happened to carry. Hostile and looping `next` values are
     * refused inside signInDestination.
     *
     * A landing choice only, never a permission one — /dashboard verifies
     * the organizer capability itself in app/dashboard/layout.tsx. */
    const wantedRole =
      request.nextUrl.searchParams.get('role') === 'organizer' ? 'organizer' : 'player';
    homeUrl.pathname = signInDestination(wantedRole, request.nextUrl.searchParams.get('next'));
    return NextResponse.redirect(homeUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /* Everything except static assets and image files. Auth routes are
     * deliberately included so token refresh happens there too. */
    '/((?!_next/static|_next/image|favicon.ico|images/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};
