'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, CheckCircle, ArrowLeftRight } from 'lucide-react';
import styles from './page.module.css';
import { elapsedSeconds, formatClock } from '../../../lib/matchClock';
import { isSetComplete, setTarget, type ScoringRules } from '../../../lib/setCompletion';

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

  /* The set-won prompt. The organizer's rules decide when a set is over, but
   * banking it still takes a tap: at 20-19 a mis-tapped point would otherwise
   * close the set on its own, and there'd be no way back. */
  const [setPrompt, setSetPrompt] = useState<{ index: number; a: number; b: number } | null>(null);
  const [promptDismissed, setPromptDismissed] = useState(false);

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
  }, [token]);

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
        // The first point is what starts the clock, and the server owns that
        // instant — so pick it up from the reply rather than reloading.
        if (res.ok) {
          const body = await res.json().catch(() => null);
          const stamp = body?.live?.startedAt;
          if (typeof stamp === 'number') setStartedAt(prev => prev ?? stamp);
        }
      } catch {
        setSyncFailed(true);
      }
    }, 400);
  }, [token]);

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

  const openOverlay = (kind: string, seconds: number) => {
    setSecondsLeft(seconds);
    setOverlay({ kind, seconds });
  };

  /* Watch the live score against the division's rules and raise the prompt the
   * moment the set is won. This is the whole point of the screen knowing the
   * format: the referee scores, and the board is what remembers whether this
   * division plays to 21, to 25, or short in the third. */
  useEffect(() => {
    if (!match || confirmed) return;
    const index = sets.length;
    if (!isSetComplete(scoreA, scoreB, index, match.rules)) {
      /* Score moved back off a winning number — usually an undo. Re-arm, so
       * reaching it again asks rather than staying silently dismissed. */
      setPromptDismissed(false);
      setSetPrompt(null);
      return;
    }
    if (promptDismissed) return;
    setSetPrompt({ index, a: scoreA, b: scoreB });
  }, [match, confirmed, sets.length, scoreA, scoreB, promptDismissed]);

  /* Once someone has the sets, ask for the result. No ref guards this against
   * reopening, because the only two ways out both change `sets`: confirming
   * ends the match, and backing out un-banks the deciding set. */
  useEffect(() => {
    if (!match || confirmed) return;
    const needed = setsToWinAt(match.rules.setsBestOf);
    const w = winsIn(sets);
    if (w.a >= needed || w.b >= needed) setShowFinalize(true);
  }, [match, confirmed, sets]);

  /* Bank the won set and start the interval clock. */
  const confirmSet = () => {
    if (!match || !setPrompt) return;
    const banked = [...sets, { a: setPrompt.a, b: setPrompt.b }];
    setSets(banked);
    setScoreA(0);
    setScoreB(0);
    setTimeouts([0, 0]); // timeouts replenish each set
    setSetPrompt(null);
    setPromptDismissed(false);

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
  const dismissSetPrompt = () => {
    setPromptDismissed(true);
    setSetPrompt(null);
  };

  /* "Back to score" on the finalize dialog. The only reason to back out of the
   * final confirmation is that the deciding set was wrong, so this puts that
   * set back on the board rather than dropping the referee on a finished
   * screen with nothing to press. */
  const reopenLastSet = () => {
    const last = sets[sets.length - 1];
    if (!last) { setShowFinalize(false); return; }
    setSets(sets.slice(0, -1));
    setScoreA(last.a);
    setScoreB(last.b);
    setPromptDismissed(true); // don't re-ask at the score they just backed out of
    setShowFinalize(false);
    setFinalizeError('');
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
        aria-label={`Add a point to ${info.name}`}
      >
        <span className={styles.scoreNum}>{score}</span>
      </button>
    );
    const minus = (
      <button
        className={`${styles.minusStrip} ${right ? styles.minusStripB : ''}`}
        onClick={() => removePoint(team)}
        disabled={score === 0}
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
        <div className={styles.tapHint}>Tap score to add a point</div>
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

        {syncFailed && (
          <div className={styles.syncBanner}>
            Not syncing — scores are safe on this device. Keep scoring; you can still submit the result.
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

        {/* Set won. A plain div, not the dismiss-on-tap overlay above — a
            stray tap during a rally must not decide a set either way. */}
        {setPrompt && !showFinalize && (
          <div className={styles.confirmScrim}>
            <div className={styles.finalizeCard}>
              <p className={styles.finalizeKicker}>
                Set {setPrompt.index + 1} · to {setTarget(setPrompt.index, match.rules)}
                {match.rules.winBy2 ? ', win by 2' : ''}
              </p>
              <p className={styles.finalizeTitle}>
                {(setPrompt.a > setPrompt.b ? match.teamA : match.teamB).name} wins the set
              </p>
              <div className={styles.finalizeResult}>
                <span>{teamOf(leftTeam).name}</span>
                <span className={styles.finalizeScore}>
                  {leftTeam === 'A' ? setPrompt.a : setPrompt.b} – {rightTeam === 'A' ? setPrompt.a : setPrompt.b}
                </span>
                <span>{teamOf(rightTeam).name}</span>
              </div>
              <div className={styles.finalizeActions}>
                <button className={styles.btnGhost} onClick={dismissSetPrompt}>
                  Back to score
                </button>
                <button className={styles.btnPrimary} onClick={confirmSet}>
                  Confirm set
                </button>
              </div>
            </div>
          </div>
        )}

        {showFinalize && (
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
      </div>
    </div>
  );
}
