'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X, ThumbsUp, MessageCircle, ArrowRight, MapPin, Shield, Copy, Check, Users } from 'lucide-react';
import styles from './PlayerCardModal.module.css';
import { Avatar } from './livebracket-ds';
import type { PlayerCard } from '../lib/playerCard';

/* ── Who is this player? ──────────────────────────────────────────
 *
 * Opens from a name or a photo anywhere a team is listed. Identity at the
 * top, what their results say underneath, and the three things you might
 * want to do about them along the bottom.
 *
 * Two of those three do not exist yet — there is no reactions table and
 * no messaging — so they are drawn as the disabled controls they are. A
 * button that looks live and does nothing is worse than one that says it
 * is not ready.
 *
 * What the card may show is decided by the server (see lib/playerCard.ts).
 * The private half simply arrives absent for a signed-out viewer, and the
 * card says why rather than leaving a gap.
 */

export interface PlayerCardTarget {
  /** The account behind the name, when there is one. */
  userId: string | null;
  /** What the page already knows, so the card has a name before it loads. */
  name: string;
  avatarUrl?: string;
}

/* A thin door, and the card behind it.
 *
 * Splitting them lets the card be keyed on the player it is for, so
 * opening a second player's card starts from a blank one rather than
 * from the last one's answers — no effect has to reach back and reset
 * state that a fresh mount simply does not have. */
export default function PlayerCardModal({
  target,
  onClose,
}: {
  target: PlayerCardTarget | null;
  onClose: () => void;
}) {
  if (!target) return null;
  return <Card key={target.userId ?? target.name} target={target} onClose={onClose} />;
}

function Card({ target, onClose }: { target: PlayerCardTarget; onClose: () => void }) {
  const [card, setCard] = useState<PlayerCard | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [isSelf, setIsSelf] = useState(false);
  /* Held apart from `card` so the button answers immediately and the
   * server's count replaces it a moment later. */
  const [thumbs, setThumbs] = useState<{ count: number; mine: boolean }>({ count: 0, mine: false });
  const [thumbBusy, setThumbBusy] = useState(false);
  // Nothing to fetch without an account behind the name, so that card is
  // already as loaded as it will get.
  const [state, setState] = useState<'idle' | 'loading' | 'error'>(
    target.userId ? 'loading' : 'idle',
  );
  const [copied, setCopied] = useState(false);

  const userId = target.userId;

  useEffect(() => {
    if (!userId) return;
    let cancel = false;

    fetch(`/api/players/${userId}`)
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (cancel) return;
        if (!res.ok) { setState('error'); return; }
        const loaded = body.card as PlayerCard;
        setCard(loaded);
        setThumbs(loaded.thumbs ?? { count: 0, mine: false });
        setSignedIn(!!body.viewerSignedIn);
        setIsSelf(!!body.isSelf);
        setState('idle');
      })
      .catch(() => { if (!cancel) setState('error'); });

    return () => { cancel = true; };
  }, [userId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const name = card?.name || target.name;
  const avatarUrl = card?.avatarUrl || target.avatarUrl;
  const record = card?.record;

  /* One thumb per person, so this is a toggle rather than a tally: the
   * click answers on the spot, and the server's count — which is the
   * number of *people*, enforced by the unique constraint in 0018 —
   * replaces the guess when it lands. */
  const toggleThumb = async () => {
    if (!userId || thumbBusy) return;
    const before = thumbs;
    setThumbBusy(true);
    setThumbs({
      count: before.count + (before.mine ? -1 : 1),
      mine: !before.mine,
    });
    try {
      const res = await fetch(`/api/players/${userId}/thumb`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setThumbs(before); return; }
      setThumbs({ count: body.count as number, mine: body.thumbed as boolean });
    } catch {
      setThumbs(before);
    } finally {
      setThumbBusy(false);
    }
  };

  /* The stored id from the profiles row — the number a teammate can
     actually use in the invite search — so copying it here is copying
     the same string the profile page hands out. */
  const copyPlayerId = async () => {
    if (!card?.playerId) return;
    try {
      await navigator.clipboard.writeText(card.playerId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy player ID:', err);
    }
  };

  return (
    <div
      className={styles.overlay}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`${name} — player card`}
    >
      <div className={styles.dialog}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        {/* Same identity the profile page shows — avatar, name, club and
            hometown behind their own marks, the player ID with a copy —
            stacked rather than set beside the photo, because a 400px
            dialog has height to spend and no width. */}
        <div className={styles.identity}>
          <Avatar name={name} src={avatarUrl} size={96} />
          <h2 className={styles.name}>{name}</h2>

          {(card?.club || card?.hometown) && (
            <div className={styles.metaRow}>
              {card?.club && (
                <span className={styles.metaItem}>
                  <Shield size={16} color="var(--color-primary)" aria-hidden="true" />
                  {card.club}
                </span>
              )}
              {card?.hometown && (
                <span className={styles.metaItem}>
                  <MapPin size={16} color="var(--color-primary)" aria-hidden="true" />
                  {card.hometown}
                </span>
              )}
            </div>
          )}

          {card?.playerId && (
            <div className={styles.playerIdRow}>
              <span className={styles.playerIdLabel}>Player ID:</span>
              <span className={styles.playerIdValue}>{card.playerId}</span>
              <button
                type="button"
                onClick={copyPlayerId}
                className={styles.copyBtn}
                title={copied ? 'Copied!' : 'Copy Player ID'}
                aria-label="Copy Player ID"
              >
                {copied ? <Check size={14} color="#16a34a" /> : <Copy size={14} />}
              </button>
            </div>
          )}

          {/* Absent rather than empty: the server withholds these from a
              signed-out viewer, so say so instead of showing a blank. */}
          {card && !signedIn && (
            <p className={styles.gated}>
              <Link href="/login" className={styles.gatedLink}>Sign in</Link> to see this player&apos;s
              club, hometown and player ID.
            </p>
          )}

          {!userId && (
            <p className={styles.gated}>
              This player was entered by name at registration and has no Live Bracket
              account yet.
            </p>
          )}
          {state === 'error' && (
            <p className={styles.gated}>Could not load this player right now.</p>
          )}
        </div>

        {/* ── Performance ─────────────────────────────────────── */}
        {userId && (
          <section className={styles.performance} aria-label="Performance">
            <h3 className={styles.paneTitle}>Performance</h3>
            {state === 'loading' && <p className={styles.paneNote}>Loading…</p>}
            {record && record.matchesCount === 0 && state !== 'loading' && (
              <p className={styles.paneNote}>No completed matches yet.</p>
            )}
            {record && record.matchesCount > 0 && (
              <>
                <div className={styles.statGrid}>
                  <div className={styles.stat}>
                    <span className={styles.statValue}>{record.matchesCount}</span>
                    <span className={styles.statLabel}>Matches</span>
                  </div>
                  <div className={styles.stat}>
                    <span className={styles.statValue}>{record.wins}–{record.losses}</span>
                    <span className={styles.statLabel}>W–L</span>
                  </div>
                  <div className={styles.stat}>
                    <span className={styles.statValue}>{record.winRate}%</span>
                    <span className={styles.statLabel}>Win rate</span>
                  </div>
                  <div className={styles.stat}>
                    <span className={styles.statValue}>{record.setsWon}–{record.setsLost}</span>
                    <span className={styles.statLabel}>Sets</span>
                  </div>
                </div>
                <div className={styles.statRows}>
                  {record.bestFinish && (
                    <p className={styles.statRow}>
                      <Users size={13} aria-hidden="true" />
                      <span>Best finish</span>
                      <strong>{record.bestFinish}</strong>
                    </p>
                  )}
                  {record.longestStreak > 1 && (
                    <p className={styles.statRow}>
                      <ThumbsUp size={13} aria-hidden="true" />
                      <span>Longest streak</span>
                      <strong>{record.longestStreak} wins</strong>
                    </p>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {/* ── Actions ─────────────────────────────────────────
            Reactions and messaging do not exist yet, so both are drawn
            greyed rather than dressed up as live controls. A name with no
            account behind it has neither to offer and nothing to open, so
            it gets the one button that would mean something — claiming
            it — which is also still to come. */}
        <div className={styles.actions}>
          {userId ? (
            <>
              <button
                type="button"
                className={`${styles.actionBtn} ${thumbs.mine ? styles.actionBtnOn : ''}`}
                onClick={toggleThumb}
                disabled={!signedIn || isSelf || thumbBusy || state === 'loading'}
                aria-pressed={thumbs.mine}
                title={
                  isSelf
                    ? 'You cannot thumb yourself up'
                    : !signedIn
                      ? 'Sign in to thumb a player up'
                      : thumbs.mine
                        ? 'Take your thumb up back'
                        : 'Thumb this player up'
                }
              >
                <ThumbsUp size={16} aria-hidden="true" />
                <span className={styles.actionLabel}>Thumb up</span>
                {thumbs.count > 0 && <span className={styles.actionCount}>{thumbs.count}</span>}
              </button>
              <button
                type="button"
                className={styles.actionBtn}
                disabled
                title="Messaging is not built yet"
              >
                <MessageCircle size={16} aria-hidden="true" />
                <span className={styles.actionLabel}>Chat</span>
              </button>
              <Link href={`/player/${userId}`} className={styles.actionPrimary}>
                See more <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </>
          ) : (
            <button
              type="button"
              className={styles.actionClaim}
              disabled
              title="Claiming a player is not built yet"
            >
              Claim profile
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
