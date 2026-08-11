'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import styles from './page.module.css';

interface SetScore { a: number; b: number }

interface ScoringRules {
  setsBestOf: number;
  pointsPerSet: number;
  winBy2: boolean;
  hardCap: number;
  decidingSetPoints: number;
}

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
  live: { sets: SetScore[]; a: number; b: number } | null;
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

interface Overlay { kind: string; seconds: number }

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
  const [showFinalize, setShowFinalize] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState('');
  const [syncFailed, setSyncFailed] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const [timeouts, setTimeouts] = useState<[number, number]>([0, 0]);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  // Load the match this token unlocks, and resume any score already in flight
  // so a referee who closed the tab picks up exactly where they left off.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/score/${token}`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) { setLoadError(body.error || 'This scorekeeper link is not valid.'); return; }
        setMatch(body);
        if (body.live) {
          setSets(body.live.sets ?? []);
          setScoreA(body.live.a ?? 0);
          setScoreB(body.live.b ?? 0);
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
  }, [token]);

  useEffect(() => {
    if (confirmed || !match) return;
    const id = setInterval(() => setElapsed(s => s + 1), 1000);
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
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushLive = useCallback((nextSets: SetScore[], a: number, b: number) => {
    if (!token) return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/score/${token}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sets: nextSets, a, b }),
        });
        setSyncFailed(!res.ok);
      } catch {
        setSyncFailed(true);
      }
    }, 400);
  }, [token]);

  const formatClock = (s: number) => {
    const total = Math.max(0, s);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    const p = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
  };

  /* Points move through functional updates, never through the value the
   * closure captured. The whole panel is the tap target now, so two taps
   * inside one React batch are realistic during a rally — reading `scoreA`
   * directly would score them both as the same point and silently lose
   * one. Losing a point is the worst thing this screen can do. */
  const addPoint = useCallback((team: 'A' | 'B') => {
    if (team === 'A') setScoreA(s => s + 1);
    else setScoreB(s => s + 1);
  }, []);

  const removePoint = useCallback((team: 'A' | 'B') => {
    if (team === 'A') setScoreA(s => Math.max(0, s - 1));
    else setScoreB(s => Math.max(0, s - 1));
  }, []);

  /* One push per settled score, rather than one per handler. This is what
   * makes "every point is saved" true even when several land in a batch:
   * the effect sees the final numbers and sends those. */
  const hydrated = useRef(false);
  useEffect(() => {
    if (!match || confirmed) return;
    // The first run is the state that just came back from the server —
    // echoing it straight back would flip the match to live before anyone
    // has scored.
    if (!hydrated.current) { hydrated.current = true; return; }
    pushLive(sets, scoreA, scoreB);
  }, [sets, scoreA, scoreB, match, confirmed, pushLive]);

  const completeSet = () => {
    if (scoreA === scoreB) return; // a drawn set can't be banked
    setSets(prev => [...prev, { a: scoreA, b: scoreB }]);
    setScoreA(0);
    setScoreB(0);
    setTimeouts([0, 0]); // timeouts replenish each set
  };

  const openOverlay = (kind: string, seconds: number) => {
    setSecondsLeft(seconds);
    setOverlay({ kind, seconds });
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
      setConfirmed(true);
      setShowFinalize(false);
    } catch (err) {
      setFinalizeError(err instanceof Error ? err.message : 'Could not submit the result.');
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

  const wins = {
    a: sets.filter(s => s.a > s.b).length,
    b: sets.filter(s => s.b > s.a).length,
  };
  // "Two sets wins it" for a best-of-three; derived so a best-of-five
  // division needs three without a second code path.
  const setsToWin = Math.floor(match.rules.setsBestOf / 2) + 1;
  const currentSet = sets.length + 1;
  const matchOver = wins.a >= setsToWin || wins.b >= setsToWin;

  if (confirmed) {
    return (
      <div className={styles.page}>
        <div className={styles.stateWrap}>
          <CheckCircle size={44} color="var(--color-primary)" />
          <h2 className={styles.stateTitle}>Score submitted</h2>
          <p className={styles.stateSub}>The final score has been recorded and the bracket updated.</p>
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
    return {
      n: i + 1,
      a: done ? String(done.a) : isLive ? String(scoreA) : '–',
      b: done ? String(done.b) : isLive ? String(scoreB) : '–',
      isLive,
      classA: scoreClass(done?.a ?? 0, done?.b ?? 0),
      classB: scoreClass(done?.b ?? 0, done?.a ?? 0),
    };
  });

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

        {syncFailed && (
          <div className={styles.syncBanner}>
            Not syncing — scores are safe on this device. Keep scoring; you can still submit the result.
          </div>
        )}

        {/* ── Board ────────────────────────────────────────────── */}
        <div className={styles.board}>
          {/* Team A */}
          <div className={styles.teamPanel}>
            <div className={styles.teamHead}>
              <div className={styles.teamName}>{match.teamA.name}</div>
              <div className={styles.setsWon}>Sets {wins.a}</div>
              <div className={styles.toDots}>
                {Array.from({ length: TIMEOUTS_PER_SET }, (_, i) => (
                  <span key={i} className={`${styles.toDot} ${i < timeouts[0] ? styles.toDotUsed : ''}`} />
                ))}
              </div>
            </div>
            <div className={styles.scoreRow}>
              <button
                className={styles.scoreTap}
                onClick={() => addPoint('A')}
                aria-label={`Add a point to ${match.teamA.name}`}
              >
                <span className={styles.scoreNum}>{scoreA}</span>
              </button>
              <button
                className={styles.minusStrip}
                onClick={() => removePoint('A')}
                disabled={scoreA === 0}
                aria-label={`Remove a point from ${match.teamA.name}`}
              >
                <span className={styles.minusGlyph} aria-hidden="true" />
              </button>
            </div>
            <div className={styles.tapHint}>Tap score to add a point</div>
          </div>

          {/* Sets + end set/match */}
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
            {matchOver ? (
              <button
                className={`${styles.endBtn} ${styles.endMatchBtn}`}
                onClick={() => setShowFinalize(true)}
              >
                End match
              </button>
            ) : (
              <button className={styles.endBtn} onClick={completeSet} disabled={scoreA === scoreB}>
                {scoreA === scoreB ? 'Set is tied' : `End set ${currentSet}`}
              </button>
            )}
          </div>

          {/* Team B */}
          <div className={styles.teamPanel}>
            <div className={`${styles.teamHead} ${styles.teamHeadB}`}>
              <div className={styles.toDots}>
                {Array.from({ length: TIMEOUTS_PER_SET }, (_, i) => (
                  <span key={i} className={`${styles.toDot} ${i < timeouts[1] ? styles.toDotUsed : ''}`} />
                ))}
              </div>
              <div className={styles.setsWon}>Sets {wins.b}</div>
              <div className={`${styles.teamName} ${styles.teamNameB}`}>{match.teamB.name}</div>
            </div>
            <div className={styles.scoreRow}>
              <button
                className={`${styles.minusStrip} ${styles.minusStripB}`}
                onClick={() => removePoint('B')}
                disabled={scoreB === 0}
                aria-label={`Remove a point from ${match.teamB.name}`}
              >
                <span className={styles.minusGlyph} aria-hidden="true" />
              </button>
              <button
                className={styles.scoreTap}
                onClick={() => addPoint('B')}
                aria-label={`Add a point to ${match.teamB.name}`}
              >
                <span className={styles.scoreNum}>{scoreB}</span>
              </button>
            </div>
            <div className={styles.tapHint}>Tap score to add a point</div>
          </div>
        </div>

        {/* ── Timeouts ─────────────────────────────────────────── */}
        <div className={styles.bottomBar}>
          <button
            className={styles.timeoutBtn}
            onClick={() => takeTimeout(0, match.teamA.name)}
            disabled={timeouts[0] >= TIMEOUTS_PER_SET}
          >
            Timeout
            <span className={styles.timeoutTeam}>{match.teamA.name}</span>
            <span className={styles.timeoutCount}>{timeouts[0]}/{TIMEOUTS_PER_SET}</span>
          </button>
          <button
            className={styles.techBtn}
            onClick={() => openOverlay('Technical Timeout', TECH_TIMEOUT_SECONDS)}
          >
            Technical Timeout
          </button>
          <button
            className={styles.timeoutBtn}
            onClick={() => takeTimeout(1, match.teamB.name)}
            disabled={timeouts[1] >= TIMEOUTS_PER_SET}
          >
            Timeout
            <span className={styles.timeoutTeam}>{match.teamB.name}</span>
            <span className={styles.timeoutCount}>{timeouts[1]}/{TIMEOUTS_PER_SET}</span>
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

        {showFinalize && (
          <div className={styles.confirmScrim}>
            <div className={styles.finalizeCard}>
              <p className={styles.finalizeTitle}>Confirm final result?</p>
              <div className={styles.finalizeResult}>
                <span>{match.teamA.name}</span>
                <span className={styles.finalizeScore}>{wins.a} – {wins.b}</span>
                <span>{match.teamB.name}</span>
              </div>
              {finalizeError && <p className={styles.finalizeError}>{finalizeError}</p>}
              <div className={styles.finalizeActions}>
                <button className={styles.btnGhost} onClick={() => setShowFinalize(false)} disabled={finalizing}>
                  Cancel
                </button>
                <button className={styles.btnPrimary} onClick={submitFinal} disabled={finalizing}>
                  {finalizing ? 'Submitting…' : 'Confirm & submit'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
