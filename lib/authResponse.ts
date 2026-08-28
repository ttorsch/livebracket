import { NextResponse } from 'next/server';
import { AuthError } from './auth';

/* Turns an AuthError thrown by requireOrganizer/requireTournamentOwner into
 * the response the client expects, and lets anything else propagate as a
 * 500 — an unexpected failure must not be reported as "forbidden". */
export function authErrorResponse(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : 'Unexpected error';
  return NextResponse.json({ error: message }, { status: 500 });
}
