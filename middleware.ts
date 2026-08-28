import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

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
    // Remember where they were headed so the login can finish the journey.
    loginUrl.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (user && isAuthOnly(pathname)) {
    const homeUrl = request.nextUrl.clone();
    /* Metadata is untrustworthy for *permission*, but this is only choosing
     * which landing page to send someone to — and both destinations verify
     * the role themselves. A player who forces their way to /dashboard is
     * turned around by app/dashboard/layout.tsx, not by this line. */
    homeUrl.pathname = user.user_metadata?.role === 'player' ? '/profile' : '/dashboard';
    homeUrl.search = '';
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
