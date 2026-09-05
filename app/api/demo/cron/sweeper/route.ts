import { NextResponse, type NextRequest } from 'next/server';
import { sweepExpiredSandboxes } from '@/lib/sandbox';

export const dynamic = 'force-dynamic';

/* Hourly sweeper cron for Vercel.
 *
 * Scans for sandboxes older than 24 hours, deletes their throwaway auth users,
 * and deletes the sandbox records (which cascade deletes tournaments, organizers,
 * matches, and teams). */
export async function GET(request: NextRequest) {
  // Validate Vercel cron secret if configured
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const { prunedCount } = await sweepExpiredSandboxes();
    return NextResponse.json({
      ok: true,
      prunedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('Sweeper cron failed:', err);
    return NextResponse.json(
      { error: 'Sweeper failed', message: err?.message },
      { status: 500 }
    );
  }
}
