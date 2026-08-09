'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Minus, Plus, RotateCcw, CheckCircle, AlertTriangle, CloudOff } from 'lucide-react';
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

  /* Every scoring change pushes to the live endpoint (Redis). Debounced so a
   * fast rally of taps sends one write, not six. */
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

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const addPoint = useCallback((team: 'A' | 'B') => {
    const nextA = team === 'A' ? scoreA + 1 : scoreA;
    const nextB = team === 'B' ? scoreB + 1 : scoreB;
    setScoreA(nextA);
    setScoreB(nextB);
    pushLive(sets, nextA, nextB);
  }, [scoreA, scoreB, sets, pushLive]);

  const removePoint = useCallback((team: 'A' | 'B') => {
    const nextA = team === 'A' ? Math.max(0, scoreA - 1) : scoreA;
    const nextB = team === 'B' ? Math.max(0, scoreB - 1) : scoreB;
    setScoreA(nextA);
    setScoreB(nextB);
    pushLive(sets, nextA, nextB);
  }, [scoreA, scoreB, sets, pushLive]);

  const completeSet = () => {
    if (scoreA === scoreB) return; // a drawn set can't be banked
    const next = [...sets, { a: scoreA, b: scoreB }];
    setSets(next);
    setScoreA(0);
    setScoreB(0);
    pushLive(next, 0, 0);
  };

  const resetSet = () => {
    setScoreA(0);
    setScoreB(0);
    pushLive(sets, 0, 0);
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
        <div className={styles.confirmedWrap}>
          <p className={styles.confirmedSub}>Loading match…</p>
        </div>
      </div>
    );
  }

  if (loadError || !match) {
    return (
      <div className={styles.page} style={{ background: '#0E1722' }}>
        <div className={styles.confirmedWrap}>
          <div className={styles.confirmedIcon}>
            <AlertTriangle size={48} color="#EE7A4C" />
          </div>
          <h2 className={styles.confirmedTitle}>Link not valid</h2>
          <p className={styles.confirmedSub}>
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
  const setsToWin = Math.floor(match.rules.setsBestOf / 2) + 1;
  const currentSet = sets.length + 1;
  // The deciding set is usually played to a lower target than the rest.
  const isDecider = currentSet === match.rules.setsBestOf;
  const target = isDecider ? match.rules.decidingSetPoints : match.rules.pointsPerSet;
  const matchOver = wins.a >= setsToWin || wins.b >= setsToWin;
  const isSetPoint = !matchOver && (scoreA >= target - 1 || scoreB >= target - 1);

  if (confirmed) {
    return (
      <div className={styles.page} style={{ background: '#0E1722' }}>
        <div className={styles.confirmedWrap}>
          <div className={styles.confirmedIcon}>
            <CheckCircle size={48} color="#EE7A4C" />
          </div>
          <h2 className={styles.confirmedTitle}>Score submitted!</h2>
          <p className={styles.confirmedSub}>The final score has been recorded and the bracket updated.</p>
          <div className={styles.confirmedResult}>
            <span>{match.teamA.name}</span>
            <span className={styles.confirmedSets}>{wins.a} – {wins.b}</span>
            <span>{match.teamB.name}</span>
          </div>
          {sets.length > 0 && (
            <div className={styles.setHistoryList} style={{ justifyContent: 'center', marginBottom: 20 }}>
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

  return (
    <div className={styles.page}>
      {/* ── Top bar ────────────────────────────────────────────── */}
      <header className={styles.topBar}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandMark}>
            <svg viewBox="296 73 687 687" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="639.5" cy="416.5" r="343.5" fill="#EB6F43" />
  <rect x="428" y="234" width="165.327" height="35.9406" rx="15" fill="white" />
  <rect x="428" y="561.059" width="165.327" height="35.9406" rx="15" fill="white" />
  <rect x="593.327" y="308.277" width="165.327" height="35.9406" rx="15" fill="white" />
  <rect x="722.713" y="462.822" width="129.386" height="35.9406" rx="15" fill="white" />
  <rect x="593.327" y="489.178" width="129.386" height="35.9406" rx="15" fill="white" />
  <rect x="557.386" y="416.099" width="182.099" height="35.9406" rx="15" transform="rotate(-90 557.386 416.099)" fill="white" />
  <rect x="722.713" y="498.762" width="190.485" height="35.9406" rx="15.5" transform="rotate(-90 722.713 498.762)" fill="white" />
  <rect x="557.386" y="597" width="180.901" height="35.9406" rx="15" transform="rotate(-90 557.386 597)" fill="white" />
</svg>
          </span>
          Live Bracket
        </Link>
        <div className={styles.matchMeta}>
          <span className={styles.matchRound}>{match.divisionName} · {match.roundName}</span>
          <span className={styles.matchCourt}>{match.court ?? 'Court TBD'}</span>
        </div>
        <div className={styles.timer}>
          {syncFailed ? <CloudOff size={14} color="#F16767" /> : <span className={styles.timerDot} />}
          {formatTime(elapsed)}
        </div>
      </header>

      {syncFailed && (
        <div className={styles.matchPointBanner} style={{ background: 'rgba(241,103,103,0.9)' }}>
          Not syncing — scores are safe on this device. Keep scoring; you can still submit the result.
        </div>
      )}

      {/* ── Set history ────────────────────────────────────────── */}
      {sets.length > 0 && (
        <div className={styles.setHistory}>
          <span className={styles.setHistoryLabel}>Completed sets</span>
          <div className={styles.setHistoryList}>
            {sets.map((s, i) => (
              <span key={i} className={styles.setChip}>
                Set {i + 1}: <strong>{s.a}</strong> – <strong>{s.b}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Score board ────────────────────────────────────────── */}
      <div className={styles.scoreboard}>
        <div className={styles.setIndicator}>
          SET {currentSet} · TO {target}{isDecider ? ' (DECIDER)' : ''}
        </div>
        {isSetPoint && <div className={styles.matchPointBanner}>Set point!</div>}

        <div className={styles.scoreGrid}>
          {/* Team A */}
          <div className={styles.teamBlock}>
            <div className={styles.teamName}>{match.teamA.name}</div>
            <div className={styles.winsRow}>
              {Array.from({ length: setsToWin }).map((_, i) => (
                <div key={i} className={`${styles.winDot} ${i < wins.a ? styles.winDotFilled : ''}`} />
              ))}
            </div>
            <div className={styles.scoreNum}>{scoreA}</div>
            <div className={styles.btnRow}>
              <button className={styles.minusBtn} onClick={() => removePoint('A')} aria-label={`Remove point from ${match.teamA.name}`}>
                <Minus size={22} strokeWidth={3} />
              </button>
              <button className={styles.plusBtn} onClick={() => addPoint('A')} aria-label={`Add point to ${match.teamA.name}`}>
                <Plus size={24} strokeWidth={3} />
              </button>
            </div>
          </div>

          <div className={styles.vsCol}>
            <span className={styles.vs}>VS</span>
            <div className={styles.setsScore}>
              <span>{wins.a}</span>
              <span className={styles.setsScoreDash}>–</span>
              <span>{wins.b}</span>
            </div>
          </div>

          {/* Team B */}
          <div className={styles.teamBlock}>
            <div className={styles.teamName}>{match.teamB.name}</div>
            <div className={styles.winsRow}>
              {Array.from({ length: setsToWin }).map((_, i) => (
                <div key={i} className={`${styles.winDot} ${i < wins.b ? styles.winDotFilled : ''}`} />
              ))}
            </div>
            <div className={styles.scoreNum}>{scoreB}</div>
            <div className={styles.btnRow}>
              <button className={styles.minusBtn} onClick={() => removePoint('B')} aria-label={`Remove point from ${match.teamB.name}`}>
                <Minus size={22} strokeWidth={3} />
              </button>
              <button className={styles.plusBtn} onClick={() => addPoint('B')} aria-label={`Add point to ${match.teamB.name}`}>
                <Plus size={24} strokeWidth={3} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Actions ────────────────────────────────────────────── */}
      <div className={styles.actions}>
        {!matchOver && (
          <button className={styles.completeSetBtn} onClick={completeSet} disabled={scoreA === scoreB}>
            {scoreA === scoreB ? 'Set is tied' : `Complete set ${currentSet}`}
          </button>
        )}
        {matchOver && !showFinalize && (
          <button className={styles.finalizeBtn} onClick={() => setShowFinalize(true)}>
            Finalize match result
          </button>
        )}

        {showFinalize && (
          <div className={styles.finalizeCard}
            style={{ backdropFilter: 'blur(18px) saturate(150%)', WebkitBackdropFilter: 'blur(18px) saturate(150%)' }}
          >
            <p className={styles.finalizeTitle}>Confirm final result?</p>
            <div className={styles.finalizeResult}>
              <span>{match.teamA.name}</span>
              <span className={styles.finalizeScore}>{wins.a} – {wins.b}</span>
              <span>{match.teamB.name}</span>
            </div>
            {finalizeError && (
              <p className={styles.confirmedSub} style={{ color: '#F16767', marginBottom: 12 }}>{finalizeError}</p>
            )}
            <div className={styles.finalizeActions}>
              <button className={styles.btnGhost} onClick={() => setShowFinalize(false)} disabled={finalizing}>
                Cancel
              </button>
              <button className={styles.btnPrimary} onClick={submitFinal} disabled={finalizing}>
                {finalizing ? 'Submitting…' : 'Confirm & submit'}
              </button>
            </div>
          </div>
        )}

        <button className={styles.resetBtn} onClick={resetSet}>
          <RotateCcw size={14} /> Reset set
        </button>
      </div>
    </div>
  );
}
