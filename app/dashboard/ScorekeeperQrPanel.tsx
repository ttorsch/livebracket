'use client';

import { useEffect, useState } from 'react';
import QrCodeImage from '../../components/QrCodeImage';
import styles from './page.module.css';

interface ScorekeeperMatchRow {
  matchId: string;
  token: string;
  court: string | null;
  time: string | null;
  status: 'upcoming' | 'live' | 'done';
  division: string;
  round: string;
  teamA: string;
  teamB: string;
}

const timeLabel = (iso: string | null) => {
  if (!iso) return 'Unscheduled';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Unscheduled';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/* The organizer's sheet of scorekeeper QR codes — one per match, grouped by
 * the court it's played on, so codes can be handed to (or taped up at) the
 * right court. Each code opens that match's scoring screen directly. */
export default function ScorekeeperQrPanel({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [matches, setMatches] = useState<ScorekeeperMatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  // The panel only ever mounts from a click, so window is always there —
  // a lazy initializer avoids an effect just to read the origin.
  const [origin] = useState(() => (typeof window !== 'undefined' ? window.location.origin : ''));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tournaments/${slug}/scorekeeper`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error || 'Could not load scorekeeper links');
        setMatches(body.matches ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load scorekeeper links');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  const copy = async (matchId: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(matchId);
      setTimeout(() => setCopied(c => (c === matchId ? null : c)), 1600);
    } catch {
      /* clipboard blocked — the URL is on screen to copy by hand */
    }
  };

  // Group by court, preserving the API's live-first / by-time ordering.
  const byCourt = matches.reduce<Record<string, ScorekeeperMatchRow[]>>((acc, m) => {
    const key = m.court ?? 'Court not assigned';
    (acc[key] ||= []).push(m);
    return acc;
  }, {});

  return (
    <div className={styles.qrPanel}>
      <div className={styles.qrPanelHeader}>
        <span>Scorekeeper QR codes</span>
        <button className={styles.qrClose} onClick={onClose}>×</button>
      </div>

      {loading && <p className={styles.qrHint}>Loading matches…</p>}
      {error && <p className={styles.qrHint} style={{ color: '#E02424' }}>{error}</p>}
      {!loading && !error && matches.length === 0 && (
        <p className={styles.qrHint}>
          No matches to score yet. Draw the bracket for a division and its matches will appear here.
        </p>
      )}

      {!loading && !error && matches.length > 0 && (
        <>
          <p className={styles.qrHint}>
            Each code opens the scoring screen for one match. Anyone with the link can score it — share only
            with your referees.
          </p>
          {Object.entries(byCourt).map(([court, list]) => (
            <div key={court} className={styles.qrCourtGroup}>
              <div className={styles.qrCourtName}>{court}</div>
              {list.map(m => {
                const url = `${origin}/score/${m.token}`;
                return (
                  <div key={m.matchId} className={styles.qrMatchRow}>
                    <QrCodeImage value={url} size={104} alt={`Scorekeeper QR for ${m.teamA} vs ${m.teamB}`} />
                    <div className={styles.qrMatchInfo}>
                      <div className={styles.qrMatchTop}>
                        {m.status === 'live' && <span className={styles.qrLiveTag}>Live</span>}
                        <span className={styles.qrMatchMeta}>{m.division} · {m.round}</span>
                      </div>
                      <div className={styles.qrMatchTeams}>{m.teamA} vs {m.teamB}</div>
                      <div className={styles.qrMatchMeta}>{timeLabel(m.time)}</div>
                      <div className={styles.qrLink}>
                        <span className={styles.qrUrl}>/score/{m.token.slice(0, 10)}…</span>
                        <button className={styles.copyBtn} onClick={() => copy(m.matchId, url)}>
                          {copied === m.matchId ? 'Copied!' : 'Copy link'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
