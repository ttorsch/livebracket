'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import QrCodeImage from './QrCodeImage';
import { Badge, Button } from './livebracket-ds';
import { nextPerCourt, clockLabel, type ScorekeeperLinkRow } from '../lib/scorekeeperLinks';
import styles from './ScorekeeperQrCards.module.css';

/* The scorekeeper QR card, in the one shape it takes everywhere: code on
 * top, then teams, division/round, time, token — the same order as a cell
 * of the printed sheet, so a code on screen and the same code on paper are
 * recognisably the one thing.
 *
 * Used by the live court board on the dashboard and by the per-tournament
 * QR panel; keeping it here is what stops those two drifting apart. */

/** Fetch the scorekeeper links for a tournament (matches still to play). */
export function useScorekeeperLinks(slug: string | null) {
  const [matches, setMatches] = useState<ScorekeeperLinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!slug) return;
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

  return { matches, loading, error };
}

/* Build and download the printable sheet for a tournament.
 *
 * Shared by both surfaces because the live tournament is hidden from the
 * dashboard list (see visibleTournaments), so its QR panel — and its export
 * button — can't be reached on the very day an organizer wants the sheet.
 *
 * The sheet covers every match including finished ones, so it stays valid
 * as an archive of the day; that's a second fetch, since these surfaces
 * deliberately load only what's still to be played. jsPDF is imported here
 * rather than at module scope to keep ~350KB out of the dashboard bundle
 * for the majority of organizers who never export. */
export function useQrPdfExport(slug: string) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const exportAll = async () => {
    setExporting(true);
    setError('');
    try {
      const res = await fetch(`/api/tournaments/${slug}/scorekeeper?scope=all`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not load matches');
      const { buildScorekeeperPdf } = await import('../lib/scorekeeperPdf');
      buildScorekeeperPdf({
        title: body.tournament?.title ?? slug,
        slug,
        origin: window.location.origin,
        matches: body.matches ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the PDF');
    } finally {
      setExporting(false);
    }
  };

  return { exportAll, exporting, error };
}

/** One row per court — the next match on that court, its code, and the two
 *  ways to hand it to a referee: copy the link, or open the screen. */
interface ZoomedCode {
  court: string;
  url: string;
  match: ScorekeeperLinkRow;
}

export default function ScorekeeperQrCards({ matches }: { matches: ScorekeeperLinkRow[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState<ZoomedCode | null>(null);
  // Only ever rendered client-side, so window is there — a lazy initializer
  // avoids an effect just to read the origin.
  const [origin] = useState(() => (typeof window !== 'undefined' ? window.location.origin : ''));

  /* Escape closes, and the page behind stops scrolling while it's open —
   * both are what anyone expects of a thing covering the screen. */
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoomed(null); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [zoomed]);

  const copy = async (matchId: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(matchId);
      setTimeout(() => setCopied(c => (c === matchId ? null : c)), 1600);
    } catch {
      /* clipboard blocked — the code itself is on screen to scan instead */
    }
  };

  return (
    <div className={styles.rows}>
      {nextPerCourt(matches).map(([court, m]) => {
        const url = `${origin}/score/${m.token}`;
        const isCopied = copied === m.matchId;
        const clock = clockLabel(m.time);
        return (
          <div key={court} className={styles.row}>
            <div className={styles.identity}>
              <button
                type="button"
                className={styles.codeFrame}
                onClick={() => setZoomed({ court, url, match: m })}
                aria-label={`Enlarge the scorekeeper code for ${court}`}
              >
                <QrCodeImage
                  value={url}
                  size={64}
                  className={styles.code}
                  alt={`Scorekeeper QR for ${m.teamA} vs ${m.teamB}`}
                />
              </button>
              <div className={styles.courtCol}>
                <span className={styles.court}>{court}</span>
                <div>
                  <Badge variant={m.status === 'live' ? 'live' : 'status'}>
                    {m.status === 'live' ? 'Live' : 'Up next'}
                  </Badge>
                </div>
              </div>
            </div>

            <div className={styles.detail}>
              <span className={styles.matchup}>{m.teamA} vs {m.teamB}</span>
              <span className={styles.meta}>{m.division} · {m.round}</span>
              {/* When the match runs, on its own line under the division —
                  the day of the event rather than a calendar date, and the
                  same clock the organizer set on the schedule. */}
              <span className={styles.schedule}>
                {m.day !== null && <span>Day {m.day}</span>}
                {m.day !== null && clock && <span className={styles.metaDot} aria-hidden="true" />}
                <span>{clock ? `Scheduled at ${clock}` : 'Not scheduled yet'}</span>
              </span>
            </div>

            <div className={styles.actions}>
              <Button
                variant="general"
                size="small"
                onClick={() => copy(m.matchId, url)}
                aria-label={`Copy the scoring link for ${court}`}
                style={{ border: '1.5px solid var(--color-primary)' }}
              >
                {isCopied ? 'Copied' : 'Copy link'}
              </Button>
              {/* Opens in a new tab on purpose: the organizer is mid-task on
                  this page, and the scoring screen is a separate job. */}
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.openLink}
                aria-label={`Open the scoring screen for ${court}`}
              >
                <Button variant="arrow" size="small" tabIndex={-1} />
              </a>
            </div>
          </div>
        );
      })}

      {/* Portalled to <body>: the card it lives in sets overflow: hidden, and
          fixed positioning inside a transformed ancestor would be clipped. */}
      {zoomed && createPortal(
        <div
          className={styles.lightbox}
          role="dialog"
          aria-modal="true"
          aria-label={`Scorekeeper code for ${zoomed.court}`}
          onClick={() => setZoomed(null)}
        >
          {/* Clicks inside the panel must not reach the backdrop's handler. */}
          <div className={styles.lightboxPanel} onClick={e => e.stopPropagation()}>
            <button
              type="button"
              className={styles.lightboxClose}
              onClick={() => setZoomed(null)}
              aria-label="Close"
              autoFocus
            >
              <X size={18} />
            </button>
            <span className={styles.lightboxCourt}>{zoomed.court}</span>
            <QrCodeImage
              value={zoomed.url}
              size={600}
              className={styles.lightboxCode}
              alt={`Scorekeeper QR for ${zoomed.match.teamA} vs ${zoomed.match.teamB}`}
            />
            <span className={styles.lightboxMatchup}>
              {zoomed.match.teamA} vs {zoomed.match.teamB}
            </span>
            <span className={styles.lightboxHint}>Scan to open the scoring screen</span>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
