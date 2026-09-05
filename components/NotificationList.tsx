'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ThumbsUp, UserPlus, Check, X } from 'lucide-react';
import styles from './NotificationList.module.css';
import { Avatar } from './livebracket-ds';
import type { NotificationItem } from '../lib/notifications';

/* ── What one account has been told ───────────────────────────────
 *
 * An invitation is answered from the row itself rather than by being
 * sent somewhere else to do it: the notification *is* the question, and
 * a list that can only say "you were asked something" has moved the work
 * rather than done it.
 *
 * A row whose invitation has already been answered keeps its place and
 * says what was said. Notifications are a record of what happened, so
 * nothing here is ever removed for having been dealt with.
 */

function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

const who = (n: NotificationItem) => n.actor.name || 'Someone';

function Line({ n }: { n: NotificationItem }) {
  const team = n.payload.teamName;
  const event = n.payload.tournamentTitle;

  switch (n.kind) {
    case 'thumb_up':
      return <><strong>{who(n)}</strong> thumbed you up.</>;
    case 'team_invite':
      return (
        <>
          <strong>{who(n)}</strong> put you on{' '}
          <strong>{team || 'a team'}</strong>
          {event ? <> for {event}</> : null}.
        </>
      );
    case 'invite_accepted':
      return (
        <>
          <strong>{who(n)}</strong> accepted your invitation to{' '}
          <strong>{team || 'the team'}</strong>
          {event ? <> for {event}</> : null}.
        </>
      );
    case 'invite_declined':
      return (
        <>
          <strong>{who(n)}</strong> declined your invitation to{' '}
          <strong>{team || 'the team'}</strong>
          {event ? <> for {event}</> : null}.
        </>
      );
  }
}

function KindMark({ kind }: { kind: NotificationItem['kind'] }) {
  if (kind === 'thumb_up') {
    return (
      <span className={`${styles.mark} ${styles.markThumb}`} aria-hidden="true">
        <ThumbsUp size={12} />
      </span>
    );
  }
  return (
    <span className={`${styles.mark} ${styles.markInvite}`} aria-hidden="true">
      <UserPlus size={12} />
    </span>
  );
}

function Row({
  n,
  onAnswer,
}: {
  n: NotificationItem;
  onAnswer: (playerRowId: string, action: 'accept' | 'decline') => Promise<'accepted' | 'declined'>;
}) {
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answerable = n.kind === 'team_invite' && n.playerRowId && n.inviteStatus === 'pending';

  const answer = async (action: 'accept' | 'decline') => {
    if (!n.playerRowId) return;
    setBusy(action);
    setError(null);
    try {
      await onAnswer(n.playerRowId, action);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className={`${styles.row} ${n.readAt ? '' : styles.rowUnread}`}>
      <span className={styles.avatarWrap}>
        <Avatar name={n.actor.name ?? ''} src={n.actor.avatarUrl ?? undefined} size={40} />
        <KindMark kind={n.kind} />
      </span>

      <div className={styles.body}>
        <p className={styles.text}>
          {n.actor.userId ? (
            <Link href={`/player/${n.actor.userId}`} className={styles.actorLink}>
              <Line n={n} />
            </Link>
          ) : (
            <Line n={n} />
          )}
        </p>

        <p className={styles.meta}>
          {ago(n.createdAt)}
          {n.payload.tournamentSlug && (
            <>
              {' · '}
              <Link href={`/tournament/${n.payload.tournamentSlug}`} className={styles.metaLink}>
                View event
              </Link>
            </>
          )}
        </p>

        {answerable && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.accept}
              onClick={() => answer('accept')}
              disabled={busy !== null}
            >
              <Check size={14} aria-hidden="true" /> {busy === 'accept' ? 'Accepting…' : 'Accept'}
            </button>
            <button
              type="button"
              className={styles.decline}
              onClick={() => answer('decline')}
              disabled={busy !== null}
            >
              <X size={14} aria-hidden="true" /> {busy === 'decline' ? 'Declining…' : 'Decline'}
            </button>
          </div>
        )}

        {/* Answered invitations keep their row and say what was said —
            declining never removes the roster slot, so "you declined"
            is the honest thing to leave behind. */}
        {n.kind === 'team_invite' && n.inviteStatus === 'accepted' && (
          <p className={`${styles.answered} ${styles.answeredYes}`}>You accepted this.</p>
        )}
        {n.kind === 'team_invite' && n.inviteStatus === 'declined' && (
          <p className={styles.answered}>You declined this.</p>
        )}
        {error && <p className={styles.error}>{error}</p>}
      </div>

      {!n.readAt && <span className={styles.unreadDot} aria-label="Unread" />}
    </li>
  );
}

export default function NotificationList({
  items,
  loading,
  error,
  onAnswer,
}: {
  items: NotificationItem[];
  loading: boolean;
  error: string | null;
  onAnswer: (playerRowId: string, action: 'accept' | 'decline') => Promise<'accepted' | 'declined'>;
}) {
  if (loading) return <p className={styles.note}>Loading…</p>;
  if (error) return <p className={styles.note}>{error}</p>;
  if (items.length === 0) {
    return (
      <div className={styles.empty}>
        <ThumbsUp size={26} aria-hidden="true" />
        <span>Nothing yet</span>
        <p className={styles.emptyBody}>
          Team invitations and recognition from other players land here.
        </p>
      </div>
    );
  }

  return (
    <ul className={styles.list}>
      {items.map(n => (
        <Row key={n.id} n={n} onAnswer={onAnswer} />
      ))}
    </ul>
  );
}
