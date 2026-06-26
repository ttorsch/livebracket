'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Minus, Plus, RotateCcw, CheckCircle } from 'lucide-react';
import styles from './page.module.css';

/* ── Sample match data (would come from token/API) ────────────── */
const MATCH = {
  id: 'qf2',
  tournament: 'Bang Niang Beach Classic 2025',
  division: "Men's Open",
  round: 'Quarterfinal',
  court: 'Court 2',
  teamA: { name: 'Kramer / de Vries', flags: '🇳🇱' },
  teamB: { name: 'Charoenwong / Rattanawong', flags: '🇹🇭' },
  targetPoints: 21,
  maxSets: 3,
};

interface SetScore { a: number; b: number }

export default function ScorekeeperPage() {
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [sets, setSets] = useState<SetScore[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [showFinalize, setShowFinalize] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [timerActive, setTimerActive] = useState(true);

  useEffect(() => {
    if (!timerActive) return;
    const id = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [timerActive]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const addPoint = useCallback((team: 'A' | 'B') => {
    if (team === 'A') setScoreA(s => s + 1);
    else setScoreB(s => s + 1);
  }, []);

  const removePoint = useCallback((team: 'A' | 'B') => {
    if (team === 'A') setScoreA(s => Math.max(0, s - 1));
    else setScoreB(s => Math.max(0, s - 1));
  }, []);

  const completeSet = () => {
    setSets(prev => [...prev, { a: scoreA, b: scoreB }]);
    setScoreA(0);
    setScoreB(0);
  };

  const winsA = sets.filter(s => s.a > s.b).length;
  const winsB = sets.filter(s => s.b > s.a).length;
  const currentSet = sets.length + 1;
  const isMatchPoint = (scoreA >= MATCH.targetPoints - 1 || scoreB >= MATCH.targetPoints - 1);
  const matchOver = sets.length >= 2 || winsA >= 2 || winsB >= 2;

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
            <span>{MATCH.teamA.flags} {MATCH.teamA.name}</span>
            <span className={styles.confirmedSets}>
              {winsA} – {winsB}
            </span>
            <span>{MATCH.teamB.name} {MATCH.teamB.flags}</span>
          </div>
          <Link href="/" className={styles.btnPrimary}>Back to events</Link>
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
          <span className={styles.matchRound}>{MATCH.division} · {MATCH.round}</span>
          <span className={styles.matchCourt}>{MATCH.court}</span>
        </div>
        <div className={styles.timer}>
          <span className={styles.timerDot} />
          {formatTime(elapsed)}
        </div>
      </header>

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
        <div className={styles.setIndicator}>SET {currentSet}</div>
        {isMatchPoint && !matchOver && (
          <div className={styles.matchPointBanner}>Match point!</div>
        )}

        <div className={styles.scoreGrid}>
          {/* Team A */}
          <div className={styles.teamBlock}>
            <div className={styles.teamFlags}>{MATCH.teamA.flags}</div>
            <div className={styles.teamName}>{MATCH.teamA.name}</div>
            <div className={styles.winsRow}>
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className={`${styles.winDot} ${i < winsA ? styles.winDotFilled : ''}`} />
              ))}
            </div>
            <div className={styles.scoreNum}>{scoreA}</div>
            <div className={styles.btnRow}>
              <button className={styles.minusBtn} onClick={() => removePoint('A')} aria-label="Remove point">
                <Minus size={22} strokeWidth={3} />
              </button>
              <button className={styles.plusBtn} onClick={() => addPoint('A')} aria-label="Add point">
                <Plus size={24} strokeWidth={3} />
              </button>
            </div>
          </div>

          <div className={styles.vsCol}>
            <span className={styles.vs}>VS</span>
            <div className={styles.setsScore}>
              <span>{winsA}</span>
              <span className={styles.setsScoreDash}>–</span>
              <span>{winsB}</span>
            </div>
          </div>

          {/* Team B */}
          <div className={styles.teamBlock}>
            <div className={styles.teamFlags}>{MATCH.teamB.flags}</div>
            <div className={styles.teamName}>{MATCH.teamB.name}</div>
            <div className={styles.winsRow}>
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className={`${styles.winDot} ${i < winsB ? styles.winDotFilled : ''}`} />
              ))}
            </div>
            <div className={styles.scoreNum}>{scoreB}</div>
            <div className={styles.btnRow}>
              <button className={styles.minusBtn} onClick={() => removePoint('B')} aria-label="Remove point">
                <Minus size={22} strokeWidth={3} />
              </button>
              <button className={styles.plusBtn} onClick={() => addPoint('B')} aria-label="Add point">
                <Plus size={24} strokeWidth={3} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Actions ────────────────────────────────────────────── */}
      <div className={styles.actions}>
        {!matchOver && (
          <button className={styles.completeSetBtn} onClick={completeSet}>
            Complete set {currentSet}
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
              <span>{MATCH.teamA.name}</span>
              <span className={styles.finalizeScore}>{winsA} – {winsB}</span>
              <span>{MATCH.teamB.name}</span>
            </div>
            <div className={styles.finalizeActions}>
              <button className={styles.btnGhost} onClick={() => setShowFinalize(false)}>Cancel</button>
              <button className={styles.btnPrimary} onClick={() => setConfirmed(true)}>
                Confirm &amp; submit
              </button>
            </div>
          </div>
        )}

        <button className={styles.resetBtn} onClick={() => { setScoreA(0); setScoreB(0); }}>
          <RotateCcw size={14} /> Reset set
        </button>
      </div>
    </div>
  );
}
