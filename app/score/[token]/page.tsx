'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, CheckCircle, ArrowLeftRight } from 'lucide-react';
import styles from './page.module.css';
import { elapsedSeconds, formatClock } from '../../../lib/matchClock';
import { isSetComplete, setTarget, type ScoringRules } from '../../../lib/setCompletion';
import { canScore, retryDelay, scoringRole, shouldRestoreLocal, totalPoints } from '../../../lib/scoreSync';

interface SetScore { a: number; b: number }

interface ScorekeeperMatch {
  matchId: string;
  status: 'upcoming' | 'live' | 'done';
  court: string | null;
  scheduledTime: string | null;
  tournamentSlug: string;
  tournamentTitle: string;
  divisionName: string;
  roundName: string;
  teamA: { id: string | null; name: string };
  teamB: { id: string | null; name: string };
  rules: ScoringRules;
  live: { sets: SetScore[]; a: number; b: number; startedAt?: number; updatedAt?: number; owner?: string | null } | null;
  finalScoreA: number[] | null;
  finalScoreB: number[] | null;
}

/* Volleyball allows two timeouts per team per set. Tracked on this device
 * only — they never reach Redis or Postgres, so a refresh clears them.
 * That's deliberate: nothing downstream consumes a timeout count, and a
 * referee who reloads mid-set is better served by a clean slate than by a
 * half-remembered one. */
const TIMEOUTS_PER_SET = 2;
const TIMEOUT_SECONDS = 30;
const TECH_TIMEOUT_SECONDS = 60;
/* FIVB Official Beach Volleyball Rules 18.1: the interval between sets is
 * one minute, and the change of ends happens inside it. (Indoor allows
 * three — this app is beach, so 60s.) */
const SET_INTERVAL_SECONDS = 60;

/* How many sets win the match at this format: two for a best-of-three,
 * three for a best-of-five. */
const setsToWinAt = (bestOf: number) => Math.floor(bestOf / 2) + 1;
const winsIn = (list: SetScore[]) => ({
  a: list.filter(s => s.a > s.b).length,
  b: list.filter(s => s.b > s.a).length,
});

/* How often a device asks the server what the score is. A follower needs to
 * look like a live board, and the owner only needs to notice it has been
 * taken over, so one interval serves both at four seconds. */
const POLL_MS = 4000;

interface Overlay { kind: string; seconds: number }

/* ── This device's identity and its unsynced points ───────────────
 *
 * Every read and write is wrapped: localStorage throws outright in some
 * private-browsing modes, and a referee must never lose a scoreboard to a
 * storage setting. Without it the screen still scores and still syncs — it
 * just can't recover points across a crash, which is the thing it was
 * degrading from anyway. */
const DEVICE_KEY = 'lb:scorekeeper:device';
const pendingKey = (matchId: string) => `lb:scorekeeper:pending:${matchId}`;

interface PendingScore {
  sets: SetScore[];
  a: number;
  b: number;
  updatedAt: number;
  /* Set only on a deliberate take-over, so the claim travels with the write
   * it belongs to rather than living in state of its own. */
  claim?: boolean;
}

function readDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
  } catch { /* storage unavailable — fall through to a session-only id */ }
  const fresh =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  try { localStorage.setItem(DEVICE_KEY, fresh); } catch { /* session-only */ }
  return fresh;
}

function readPending(matchId: string): PendingScore | null {
  try {
    const raw = localStorage.getItem(pendingKey(matchId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingScore;
    // Anything malformed is discarded rather than half-restored: a partial
    // scoreboard is worse than starting from what the server has.
    if (!Array.isArray(parsed?.sets) || typeof parsed?.updatedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePending(matchId: string, value: PendingScore | null) {
  try {
    if (value) localStorage.setItem(pendingKey(matchId), JSON.stringify(value));
    else localStorage.removeItem(pendingKey(matchId));
  } catch { /* storage unavailable — the in-memory retry queue still runs */ }
}

export default function ScorekeeperPage() {
  const params = useParams();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;

  const [match, setMatch] = useState<ScorekeeperMatch | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);

  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [sets, setSets] = useState<SetScore[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState('');
  const [byeModalOpen, setByeModalOpen] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  /* The match clock runs from the first point, stamped into the live state
   * server-side — not from when this tab opened. So a referee who reloads
   * mid-match keeps the real elapsed time, and the organizer's court board
   * shows the same number. Null until the first point lands. */
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const elapsed = elapsedSeconds(startedAt, now) ?? 0;

  const [timeouts, setTimeouts] = useState<[number, number]>([0, 0]);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  /* Which team is on the near side of the court. Display only — it never
   * touches scoreA/scoreB or anything pushed to Redis, so swapping ends can
   * never send the wrong team to the bracket. */
  const [swapped, setSwapped] = useState(false);

  /* The set-won prompt is derived from the score, so the only thing worth
   * storing is that the referee waved it away. Keyed to a tap counter rather
   * than to the score: after "back to score" at 21-19, taking a point off and
   * legitimately winning it back must ask again, and a counter that only ever
   * goes up is what tells those two 21-19s apart. */
  const [pointSeq, setPointSeq] = useState(0);
  const [dismissedSeq, setDismissedSeq] = useState<number | null>(null);

  /* Cross-device state. `owner` is whichever device is scoring; this one
   * follows read-only when that isn't us. */
  /* Read lazily rather than in an effect so it exists on the first client
   * render and the load below doesn't wait a tick for it. Safe against
   * hydration because nothing rendered depends on it: `owner` is null until
   * the server says otherwise, which makes every device 'unclaimed' — and
   * so identically interactive — on that first paint. */
  const [deviceId] = useState(() => (typeof window === 'undefined' ? '' : readDeviceId()));
  const [owner, setOwner] = useState<string | null>(null);
  const [takenOver, setTakenOver] = useState(false);
  const [restoredPoints, setRestoredPoints] = useState<number | null>(null);
  const [matchId, setMatchId] = useState('');

  /* Every change to the board bumps `revision`; the sync effect below is
   * what watches it. Zero means "nothing has happened since load", which is
   * how the screen avoids echoing the server's own state straight back and
   * flipping a match to live before anyone has scored.
   *
   * `attempt` is the retry counter: raising it re-runs the sync effect on a
   * longer timer, so backing off needs no timer bookkeeping of its own. */
  const [revision, setRevision] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [claimPending, setClaimPending] = useState(false);
  const bumpRevision = useCallback(() => { setRevision(n => n + 1); setAttempt(0); }, []);

  const role = scoringRole(owner, deviceId);
  const scoring = canScore(role);

  // Load the match this token unlocks, and resume any score already in flight
  // so a referee who closed the tab picks up exactly where they left off.
  useEffect(() => {
    if (!token || !deviceId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/score/${token}`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) { setLoadError(body.error || 'This scorekeeper link is not valid.'); return; }
        setMatch(body);
        setMatchId(body.matchId);

        const liveOwner = (body.live?.owner ?? null) as string | null;
        setOwner(liveOwner);

        /* Points this device couldn't push last time it was open. They only
         * win if they are genuinely newer than what the server holds, and
         * only if this device is still entitled to score — restoring over
         * another device's live match would be the very overwrite the
         * ownership rule exists to prevent. */
        const pending = readPending(body.matchId);
        const mayScore = canScore(scoringRole(liveOwner, deviceId));
        if (mayScore && shouldRestoreLocal(pending, body.live)) {
          setSets(pending!.sets);
          setScoreA(pending!.a);
          setScoreB(pending!.b);
          setStartedAt(body.live?.startedAt ?? null);
          /* How many points were actually rescued — the difference against
           * what the server had, not the size of the board. Saying "restored
           * 53 points" when three were at risk reads as though the whole
           * match nearly vanished. A correction can make this zero or
           * negative, which the banner words differently rather than
           * claiming a recovery of "-1 points". */
          setRestoredPoints(totalPoints(pending!) - (body.live ? totalPoints(body.live) : 0));
          bumpRevision(); // the sync effect sends it back up
        } else if (body.live) {
          setSets(body.live.sets ?? []);
          setScoreA(body.live.a ?? 0);
          setScoreB(body.live.b ?? 0);
          setStartedAt(body.live.startedAt ?? null);
        } else if (body.status === 'done' && body.finalScoreA) {
          setSets((body.finalScoreA as number[]).map((a, i) => ({ a, b: body.finalScoreB?.[i] ?? 0 })));
        }
        if (body.status === 'done') setConfirmed(true);
      } catch {
        if (!cancelled) setLoadError('Could not load this match. Check your connection and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, deviceId, bumpRevision]);

  useEffect(() => {
    if (confirmed || !match) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [confirmed, match]);

  // The overlay counts down for real rather than showing a frozen number —
  // a referee holding the phone up is the only clock on the court.
  useEffect(() => {
    if (!overlay) return;
    const id = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) { setOverlay(null); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [overlay]);

  /* Every scoring change pushes to the live endpoint (Redis) so the public
   * bracket and the organizer dashboard follow along. Debounced so a fast
   * rally of taps sends one write rather than six — the last tap still
   * lands, which is what "every point is saved" needs. */
  /* Get the board to the server, and keep trying until it lands.
   *
   * Driven by `revision`, so it fires on real changes rather than on every
   * render, and it sends whole state — which is what makes a retry after an
   * outage push where the match actually is rather than replaying where it
   * was when the connection dropped. A tap during the wait replaces the
   * timer, which is also what debounces a fast rally into one write.
   *
   * The score goes to localStorage before any request leaves, because the
   * point has to survive the phone dying mid-flight. That is the case this
   * whole path exists for. */
  useEffect(() => {
    if (!match || confirmed || !token || !matchId || !deviceId) return;
    if (revision === 0) return;   // nothing has changed since load
    /* A follower is read-only — except for the one write that stops it being
     * a follower. Claiming has to go out from exactly the state that isn't
     * allowed to write, so it is the deliberate exception rather than a hole
     * in the rule. */
    if (!scoring && !claimPending) return;

    const payload: PendingScore = { sets, a: scoreA, b: scoreB, updatedAt: Date.now() };
    writePending(matchId, payload);

    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/score/${token}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sets: payload.sets, a: payload.a, b: payload.b, deviceId, claim: claimPending,
          }),
        });
        if (cancelled) return;

        /* Another device took the match while this one was scoring. Its
         * state is the truth now, so adopt it rather than retrying into a
         * fight this device has already lost. Anything this device had
         * queued goes with it — which is why taking over is a deliberate
         * tap on the other screen and not something that just happens. */
        if (res.status === 409) {
          const body = await res.json().catch(() => null);
          if (cancelled) return;
          writePending(matchId, null);
          setAttempt(0);
          setClaimPending(false);
          setSyncFailed(false);
          setTakenOver(true);
          if (body?.live) {
            setOwner(body.live.owner ?? null);
            setSets(body.live.sets ?? []);
            setScoreA(body.live.a ?? 0);
            setScoreB(body.live.b ?? 0);
            setStartedAt(body.live.startedAt ?? null);
          }
          return;
        }

        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json().catch(() => null);
        if (cancelled) return;

        writePending(matchId, null);
        setAttempt(0);
        setClaimPending(false);
        setSyncFailed(false);
        setTakenOver(false);
        if (body?.live?.owner) setOwner(body.live.owner);
        // The first point starts the clock and the server owns that instant,
        // so take it from the reply rather than reloading.
        const stamp = body?.live?.startedAt;
        if (typeof stamp === 'number') setStartedAt(prev => prev ?? stamp);
      } catch {
        /* The score is already on this device, so this is about reaching the
         * server, not about keeping it. Back off and try again for as long
         * as the tab lives. */
        if (cancelled) return;
        setSyncFailed(true);
        setAttempt(n => n + 1);
      }
    }, attempt === 0 ? 400 : retryDelay(attempt - 1));

    return () => { cancelled = true; clearTimeout(id); };
  }, [
    revision, attempt, sets, scoreA, scoreB, claimPending,
    match, confirmed, token, matchId, deviceId, scoring,
  ]);

  /* Points move through functional updates, never through the value the
   * closure captured. The whole panel is the tap target now, so two taps
   * inside one React batch are realistic during a rally — reading `scoreA`
   * directly would score them both as the same point and silently lose
   * one. Losing a point is the worst thing this screen can do. */
  const addPoint = useCallback((team: 'A' | 'B') => {
    if (team === 'A') setScoreA(s => s + 1);
    else setScoreB(s => s + 1);
    setPointSeq(n => n + 1);
    bumpRevision();
  }, [bumpRevision]);

  const removePoint = useCallback((team: 'A' | 'B') => {
    if (team === 'A') setScoreA(s => Math.max(0, s - 1));
    else setScoreB(s => Math.max(0, s - 1));
    setPointSeq(n => n + 1);
    bumpRevision();
  }, [bumpRevision]);

  /* Ask the server what the score is.
   *
   * A follower is a live board and adopts everything it hears. The owner
   * ignores the score — its own board is the truth — and listens only for
   * having been taken over, which is the one thing it cannot know locally.
   * Either way a failed poll is silence, not an error: the retry queue is
   * what guarantees points, and a red banner every four seconds on a weak
   * signal would just teach the referee to ignore it. */
  useEffect(() => {
    if (!match || confirmed || !token || !deviceId) return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/score/${token}`);
        if (!res.ok || cancelled) return;
        const body = await res.json();

        // Finalized somewhere else — follow it rather than keep scoring a
        // match that is already in the bracket.
        if (body.status === 'done') {
          if (body.finalScoreA) {
            setSets((body.finalScoreA as number[]).map((a: number, i: number) => ({
              a, b: body.finalScoreB?.[i] ?? 0,
            })));
          }
          setConfirmed(true);
          return;
        }

        const liveOwner = (body.live?.owner ?? null) as string | null;
        setOwner(prev => (prev === liveOwner ? prev : liveOwner));

        if (scoringRole(liveOwner, deviceId) !== 'follower') return;
        setSets(body.live?.sets ?? []);
        setScoreA(body.live?.a ?? 0);
        setScoreB(body.live?.b ?? 0);
        setStartedAt(body.live?.startedAt ?? null);
      } catch {
        /* Offline. The next tick tries again. */
      }
    }, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [match, confirmed, token, deviceId]);

  /* Take the match from whichever device holds it. Deliberate, because the
   * device losing it is someone else's phone at the same net. */
  const takeOver = useCallback(() => {
    setTakenOver(false);
    setClaimPending(true);
    bumpRevision();
  }, [bumpRevision]);

  const openOverlay = (kind: string, seconds: number) => {
    setSecondsLeft(seconds);
    setOverlay({ kind, seconds });
  };

  /* Bank the won set and start the interval clock. */
  const confirmSet = (a: number, b: number) => {
    if (!match) return;
    const banked = [...sets, { a, b }];
    setSets(banked);
    setScoreA(0);
    setScoreB(0);
    setTimeouts([0, 0]); // timeouts replenish each set
    setDismissedSeq(null);
    bumpRevision();

    // A match-winning set hands over to the finalize dialog rather than
    // sending the referee off for a rest that isn't coming.
    const needed = setsToWinAt(match.rules.setsBestOf);
    const w = winsIn(banked);
    if (w.a < needed && w.b < needed) {
      openOverlay(`Set ${banked.length} over — interval`, SET_INTERVAL_SECONDS);
    }
  };

  /* "Back to score" on the set prompt: the set stays open and the board keeps
   * the score it had, so a mis-tapped point can just be taken off. */
  const dismissSetPrompt = () => setDismissedSeq(pointSeq);

  /* "Back to score" on the finalize dialog. The only reason to back out of the
   * final confirmation is that the deciding set was wrong, so this puts that
   * set back on the board rather than dropping the referee on a finished
   * screen with nothing to press. Un-banking it is also what closes the
   * dialog: the match stops being decided. */
  const reopenLastSet = () => {
    const last = sets[sets.length - 1];
    if (!last) return;
    setSets(sets.slice(0, -1));
    setScoreA(last.a);
    setScoreB(last.b);
    setDismissedSeq(pointSeq); // don't re-ask at the score they just backed out of
    setFinalizeError('');
    bumpRevision();
  };

  const takeTimeout = (side: 0 | 1, teamName: string) => {
    if (timeouts[side] >= TIMEOUTS_PER_SET) return;
    setTimeouts(t => {
      const next: [number, number] = [t[0], t[1]];
      next[side] = next[side] + 1;
      return next;
    });
    openOverlay(`Timeout — ${teamName}`, TIMEOUT_SECONDS);
  };

  const submitFinal = async () => {
    if (!token || finalizing) return;
    setFinalizing(true);
    setFinalizeError('');
    try {
      const res = await fetch(`/api/score/${token}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sets }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not submit the result.');
      // The bracket has it now, so nothing is left to retry.
      writePending(matchId, null);
      setConfirmed(true);
    } catch (err) {
      setFinalizeError(err instanceof Error ? err.message : 'Could not submit the result.');
    } finally {
      setFinalizing(false);
    }
  };

  const submitByeWinner = async (winner: 'A' | 'B') => {
    if (!token || finalizing) return;
    setFinalizing(true);
    setFinalizeError('');
    const byeSets: SetScore[] = winner === 'A'
      ? [{ a: 21, b: 0 }, { a: 21, b: 0 }]
      : [{ a: 0, b: 21 }, { a: 0, b: 21 }];
    try {
      const res = await fetch(`/api/score/${token}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sets: byeSets, isBye: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not submit the forfeit result.');
      writePending(matchId, null);
      setSets(byeSets);
      setScoreA(0);
      setScoreB(0);
      setConfirmed(true);
      setByeModalOpen(false);
    } catch (err) {
      setFinalizeError(err instanceof Error ? err.message : 'Could not submit the forfeit result.');
    } finally {
      setFinalizing(false);
    }
  };


  /* ── Loading / invalid-token states ─────────────────────────── */
  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.stateWrap}>
          <p className={styles.stateSub}>Loading match…</p>
        </div>
      </div>
    );
  }

  if (loadError || !match) {
    return (
      <div className={styles.page}>
        <div className={styles.stateWrap}>
          <AlertTriangle size={44} color="var(--color-primary)" />
          <h2 className={styles.stateTitle}>Link not valid</h2>
          <p className={styles.stateSub}>
            {loadError || 'This scorekeeper link is not valid.'} Scan the QR code on your court again, or ask the
            organizer for a fresh link.
          </p>
          <Link href="/" className={styles.btnPrimary}>Back to events</Link>
        </div>
      </div>
    );
  }

  const wins = winsIn(sets);
  // "Two sets wins it" for a best-of-three; derived so a best-of-five
  // division needs three without a second code path.
  const setsToWin = setsToWinAt(match.rules.setsBestOf);
  const matchOver = wins.a >= setsToWin || wins.b >= setsToWin;

  /* Which team the referee sees on the left. Everything on the live board —
   * panels, the sets column, the confirm dialogs — reads off these, so the
   * screen matches the court after a change of ends. */
  const leftTeam: 'A' | 'B' = swapped ? 'B' : 'A';
  const rightTeam: 'A' | 'B' = swapped ? 'A' : 'B';
  const teamOf = (t: 'A' | 'B') => (t === 'A' ? match.teamA : match.teamB);
  const scoreOf = (t: 'A' | 'B') => (t === 'A' ? scoreA : scoreB);
  const setsWonBy = (t: 'A' | 'B') => (t === 'A' ? wins.a : wins.b);
  const inSet = (set: SetScore, t: 'A' | 'B') => (t === 'A' ? set.a : set.b);

  /* The set on the board, measured against the organizer's rules. This is the
   * bit that used to be missing: the referee no longer has to notice 21. */
  const liveSetIndex = sets.length;
  const setWon = !matchOver && isSetComplete(scoreA, scoreB, liveSetIndex, match.rules);
  const setPrompt = setWon && dismissedSeq !== pointSeq;

  /* Decided means done — the only way out of this dialog other than
   * submitting is to un-bank the deciding set, which makes it false again. */
  const showFinalize = matchOver;

  if (confirmed) {
    const isForfeit = sets.length >= 2 && ((sets[0].a === 21 && sets[0].b === 0 && sets[1].a === 21 && sets[1].b === 0) || (sets[0].a === 0 && sets[0].b === 21 && sets[1].a === 0 && sets[1].b === 21));
    return (
      <div className={styles.page}>
        <div className={styles.stateWrap}>
          <CheckCircle size={44} color="var(--color-primary)" />
          <h2 className={styles.stateTitle}>Score submitted</h2>
          <p className={styles.stateSub}>
            {isForfeit
              ? 'The forfeit / bye result has been recorded (21–0, 21–0) and the bracket updated.'
              : 'The final score has been recorded and the bracket updated.'}
          </p>
          <div className={styles.stateResult}>
            <span>{match.teamA.name}</span>
            <span className={styles.stateSets}>{wins.a} – {wins.b}</span>
            <span>{match.teamB.name}</span>
          </div>
          {sets.length > 0 && (
            <div className={styles.setChipRow}>
              {sets.map((s, i) => (
                <span key={i} className={styles.setChip}>
                  Set {i + 1}: <strong>{s.a}</strong> – <strong>{s.b}</strong>
                </span>
              ))}
              {isForfeit && (
                <span className={`${styles.setChip} ${styles.setChipForfeit}`}>
                  Bye (Forfeit)
                </span>
              )}
            </div>
          )}
          <Link href={`/tournament/${match.tournamentSlug}`} className={styles.btnPrimary}>
            View tournament
          </Link>
        </div>
      </div>
    );
  }

  const dateLabel = match.scheduledTime
    ? new Date(match.scheduledTime).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
    : '—';
  const startLabel = match.scheduledTime
    ? new Date(match.scheduledTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '—';

  /* One row per set in the match format: banked sets show their result,
   * the set being played tracks the live score, the rest sit as dashes so
   * the column doesn't reflow as the match goes on. */
  const setRows = Array.from({ length: match.rules.setsBestOf }, (_, i) => {
    const done = sets[i];
    const isLive = i === sets.length && !matchOver;
    const scoreClass = (mine: number, theirs: number) => {
      if (done) return mine > theirs ? styles.setScoreWon : styles.setScoreDone;
      return isLive ? styles.setScoreLive : '';
    };
    const cell = (t: 'A' | 'B') =>
      done ? String(inSet(done, t)) : isLive ? String(scoreOf(t)) : '–';
    return {
      n: i + 1,
      a: cell(leftTeam),
      b: cell(rightTeam),
      isLive,
      classA: scoreClass(done ? inSet(done, leftTeam) : 0, done ? inSet(done, rightTeam) : 0),
      classB: scoreClass(done ? inSet(done, rightTeam) : 0, done ? inSet(done, leftTeam) : 0),
    };
  });

  /* One team panel. Layout follows the side of the court it is drawn on, and
   * the team follows the swap — so the minus strip and the name always sit on
   * the outside edge whichever team is standing there. */
  const teamPanel = (team: 'A' | 'B', side: 'left' | 'right') => {
    const info = teamOf(team);
    const score = scoreOf(team);
    const toIndex = team === 'A' ? 0 : 1;
    const right = side === 'right';
    const dots = (
      <div className={styles.toDots}>
        {Array.from({ length: TIMEOUTS_PER_SET }, (_, i) => (
          <span key={i} className={`${styles.toDot} ${i < timeouts[toIndex] ? styles.toDotUsed : ''}`} />
        ))}
      </div>
    );
    const name = (
      <div className={`${styles.teamName} ${right ? styles.teamNameB : ''}`}>{info.name}</div>
    );
    const setsWon = <div className={styles.setsWon}>Sets {setsWonBy(team)}</div>;
    const tap = (
      <button
        className={styles.scoreTap}
        onClick={() => addPoint(team)}
        disabled={!scoring}
        aria-label={`Add a point to ${info.name}`}
      >
        <span className={styles.scoreNum}>{score}</span>
      </button>
    );
    const minus = (
      <button
        className={`${styles.minusStrip} ${right ? styles.minusStripB : ''}`}
        onClick={() => removePoint(team)}
        disabled={!scoring || score === 0}
        aria-label={`Remove a point from ${info.name}`}
      >
        <span className={styles.minusGlyph} aria-hidden="true" />
      </button>
    );
    return (
      <div className={styles.teamPanel} key={team}>
        <div className={`${styles.teamHead} ${right ? styles.teamHeadB : ''}`}>
          {right ? <>{dots}{setsWon}{name}</> : <>{name}{setsWon}{dots}</>}
        </div>
        <div className={styles.scoreRow}>{right ? <>{minus}{tap}</> : <>{tap}{minus}</>}</div>
        <div className={styles.tapHint}>
          {scoring ? 'Tap score to add a point' : 'Following — take over to score'}
        </div>
      </div>
    );
  };

  return (
    <div className={styles.page}>
      {/* The board is always the landscape layout — in portrait the CSS
          counter-rotates it so scoring never waits on the device turning. */}
      <div className={styles.shell}>
        {/* ── Top bar ──────────────────────────────────────────── */}
        <header className={styles.topBar}>
          <span className={styles.liveTag}>
            <span className={styles.liveDot} aria-hidden="true" />
            Live
          </span>
          <span className={styles.barDivider} aria-hidden="true" />
          <span className={styles.barTitle}>
            {match.tournamentTitle}{match.court ? ` — ${match.court}` : ''}
          </span>
          <span className={styles.barSpacer} />
          <span className={`${styles.barStat} ${styles.barStatOptional}`}>
            Date<b>{dateLabel}</b>
          </span>
          <span className={styles.barStat}>Start<b>{startLabel}</b></span>
          <span className={`${styles.barStat} ${styles.barStatWide}`}>
            Duration<b>{formatClock(elapsed)}</b>
          </span>
        </header>

        {/* Another device holds the match. This one is a live board until
            the referee deliberately takes it. */}
        {role === 'follower' && (
          <div className={styles.followBanner}>
            <span className={styles.followDot} aria-hidden="true" />
            <span>
              {takenOver
                ? 'Another device took over scoring — you are following live.'
                : 'Another device is scoring — you are following live.'}
            </span>
            <button className={styles.takeOverBtn} onClick={takeOver}>
              Take over scoring
            </button>
          </div>
        )}

        {restoredPoints !== null && (
          <div className={styles.restoreBanner}>
            {restoredPoints > 0
              ? `Restored ${restoredPoints} point${restoredPoints === 1 ? '' : 's'} that had not reached the server.`
              : 'Restored the score saved on this device — it had not reached the server.'}
            <button
              className={styles.bannerDismiss}
              onClick={() => setRestoredPoints(null)}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        {syncFailed && (
          <div className={styles.syncBanner}>
            Not syncing — retrying. Every point is saved on this device and will go up when the connection returns.
          </div>
        )}

        {/* ── Board ────────────────────────────────────────────── */}
        <div className={styles.board}>
          {teamPanel(leftTeam, 'left')}

          {/* Sets + change of ends */}
          <div className={styles.centerCol}>
            <div className={styles.setsCard}>
              <div className={styles.setsLabel}>Sets</div>
              {setRows.map(row => (
                <div key={row.n} className={`${styles.setRow} ${row.isLive ? styles.setRowLive : ''}`}>
                  <span className={styles.setRowNum}>{row.n}</span>
                  <span className={`${styles.setRowScore} ${styles.setRowScoreA} ${row.classA}`}>{row.a}</span>
                  <span className={styles.setRowDash}>–</span>
                  <span className={`${styles.setRowScore} ${row.classB}`}>{row.b}</span>
                </div>
              ))}
            </div>
            {/* Sets and matches end on the organizer's rules now, so the one
                button here is the change of ends — the thing only the referee
                on the court can know about. */}
            <button
              className={styles.swapBtn}
              onClick={() => setSwapped(v => !v)}
              aria-label="Swap which team is shown on each side of the court"
            >
              <ArrowLeftRight size={13} aria-hidden="true" />
              Swap
            </button>
          </div>

          {teamPanel(rightTeam, 'right')}
        </div>

        {/* ── Timeouts ─────────────────────────────────────────── */}
        {/* Follows the change of ends too, so the button under a team is the
            one that calls their timeout. The index passed to takeTimeout is
            still the team's own, never the side's. */}
        <div className={styles.bottomBar}>
          <button
            className={styles.timeoutBtn}
            onClick={() => takeTimeout(leftTeam === 'A' ? 0 : 1, teamOf(leftTeam).name)}
            disabled={timeouts[leftTeam === 'A' ? 0 : 1] >= TIMEOUTS_PER_SET}
          >
            Timeout
            <span className={styles.timeoutTeam}>{teamOf(leftTeam).name}</span>
            <span className={styles.timeoutCount}>
              {timeouts[leftTeam === 'A' ? 0 : 1]}/{TIMEOUTS_PER_SET}
            </span>
          </button>
          <button
            className={styles.techBtn}
            onClick={() => openOverlay('Technical Timeout', TECH_TIMEOUT_SECONDS)}
          >
            Technical Timeout
          </button>
          <button
            type="button"
            className={styles.byeBtn}
            onClick={() => setByeModalOpen(true)}
            disabled={!scoring || matchOver}
            aria-label="Declare Bye or Forfeit"
          >
            Bye
          </button>
          <button
            className={styles.timeoutBtn}
            onClick={() => takeTimeout(rightTeam === 'A' ? 0 : 1, teamOf(rightTeam).name)}
            disabled={timeouts[rightTeam === 'A' ? 0 : 1] >= TIMEOUTS_PER_SET}
          >
            Timeout
            <span className={styles.timeoutTeam}>{teamOf(rightTeam).name}</span>
            <span className={styles.timeoutCount}>
              {timeouts[rightTeam === 'A' ? 0 : 1]}/{TIMEOUTS_PER_SET}
            </span>
          </button>
        </div>

        {overlay && (
          <button className={styles.overlay} onClick={() => setOverlay(null)}>
            <div className={styles.overlayCard}>
              <div className={styles.overlayKind}>{overlay.kind}</div>
              <div className={styles.overlayValue}>{formatClock(secondsLeft)}</div>
              <div className={styles.overlayNote}>Tap anywhere to resume</div>
            </div>
          </button>
        )}

        {/* Set won. A plain div, not the dismiss-on-tap overlay above — a
            stray tap during a rally must not decide a set either way. */}
        {setPrompt && scoring && (
          <div className={styles.confirmScrim}>
            <div className={styles.finalizeCard}>
              <p className={styles.finalizeKicker}>
                Set {liveSetIndex + 1} · to {setTarget(liveSetIndex, match.rules)}
                {match.rules.winBy2 ? ', win by 2' : ''}
              </p>
              <p className={styles.finalizeTitle}>
                {(scoreA > scoreB ? match.teamA : match.teamB).name} wins the set
              </p>
              <div className={styles.finalizeResult}>
                <span>{teamOf(leftTeam).name}</span>
                <span className={styles.finalizeScore}>
                  {scoreOf(leftTeam)} – {scoreOf(rightTeam)}
                </span>
                <span>{teamOf(rightTeam).name}</span>
              </div>
              <div className={styles.finalizeActions}>
                <button className={styles.btnGhost} onClick={dismissSetPrompt}>
                  Back to score
                </button>
                <button className={styles.btnPrimary} onClick={() => confirmSet(scoreA, scoreB)}>
                  Confirm set
                </button>
              </div>
            </div>
          </div>
        )}

        {showFinalize && scoring && (
          <div className={styles.confirmScrim}>
            <div className={styles.finalizeCard}>
              <p className={styles.finalizeTitle}>Confirm final result?</p>
              <div className={styles.finalizeResult}>
                <span>{teamOf(leftTeam).name}</span>
                <span className={styles.finalizeScore}>
                  {setsWonBy(leftTeam)} – {setsWonBy(rightTeam)}
                </span>
                <span>{teamOf(rightTeam).name}</span>
              </div>
              <div className={styles.setChipRow}>
                {sets.map((set, i) => (
                  <span key={i} className={styles.setChip}>
                    Set {i + 1}: <strong>{inSet(set, leftTeam)}</strong> – <strong>{inSet(set, rightTeam)}</strong>
                  </span>
                ))}
              </div>
              {finalizeError && <p className={styles.finalizeError}>{finalizeError}</p>}
              <div className={styles.finalizeActions}>
                <button className={styles.btnGhost} onClick={reopenLastSet} disabled={finalizing}>
                  Back to score
                </button>
                <button className={styles.btnPrimary} onClick={submitFinal} disabled={finalizing}>
                  {finalizing ? 'Submitting…' : 'Confirm & submit'}
                </button>
              </div>
            </div>
          </div>
        )}

        {byeModalOpen && scoring && (
          <div className={styles.confirmScrim}>
            <div className={styles.finalizeCard}>
              <p className={styles.finalizeKicker}>Forfeit / Bye</p>
              <p className={styles.finalizeTitle}>Declare Bye Winner</p>
              <p className={styles.finalizeSub}>
                Select the team that advances. The winner is awarded a 2–0 win (21–0, 21–0). The forfeiting team receives 0 points in standings.
              </p>
              <div className={styles.byeOptions}>
                <button
                  type="button"
                  className={styles.byeOptionBtn}
                  onClick={() => submitByeWinner('A')}
                  disabled={finalizing}
                >
                  <span className={styles.byeOptionWinner}>{match.teamA.name} wins (Bye)</span>
                  <span className={styles.byeOptionDetail}>21–0, 21–0 · {match.teamB.name} forfeits</span>
                </button>
                <button
                  type="button"
                  className={styles.byeOptionBtn}
                  onClick={() => submitByeWinner('B')}
                  disabled={finalizing}
                >
                  <span className={styles.byeOptionWinner}>{match.teamB.name} wins (Bye)</span>
                  <span className={styles.byeOptionDetail}>21–0, 21–0 · {match.teamA.name} forfeits</span>
                </button>
              </div>
              {finalizeError && <p className={styles.finalizeError}>{finalizeError}</p>}
              <div className={styles.finalizeActions}>
                <button
                  type="button"
                  className={styles.btnGhost}
                  onClick={() => setByeModalOpen(false)}
                  disabled={finalizing}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
