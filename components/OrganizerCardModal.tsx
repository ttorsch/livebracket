'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X, MapPin, Calendar, Users, MessageCircle } from 'lucide-react';
import styles from './OrganizerCardModal.module.css';
import { Avatar } from './livebracket-ds';
import type { OrganizerCard, OrganizerEvent } from '../lib/organizerCard';

/* ── Who is running this? ─────────────────────────────────────────
 *
 * Opens from the organizer at the foot of a tournament card. Identity at
 * the top, then the two questions a visitor actually has about an
 * organizer they have just met: what else is coming up, and have they
 * done this before.
 *
 * Upcoming leads because it is the one with something to act on — an
 * event you can still enter. It includes anything running right now
 * rather than filing today's tournament under history.
 *
 * Every row is a link. Someone who spots an event they like will try to
 * tap it whether or not it does anything, so it does.
 *
 * The WhatsApp button is shown to everyone, signed in or not — it hands
 * the conversation to WhatsApp rather than starting one here, so there is
 * no account for it to need. It is absent, not disabled, when the
 * organizer has given no number: a greyed button invites a second press
 * and explains nothing, while its absence is simply the truth that this
 * organizer cannot be reached that way.
 */

export interface OrganizerCardTarget {
  id: string;
  /** What the card already knows, so the dialog has a name and a face
   *  before the fetch lands rather than opening onto a spinner. */
  name: string;
  avatarUrl?: string;
}

type Tab = 'upcoming' | 'past';

/* A thin door and the card behind it, split the same way the player card
 * is: keying the card on the organizer means opening a second one starts
 * from a blank card rather than from the last one's answers. */
export default function OrganizerCardModal({
  target,
  onClose,
}: {
  target: OrganizerCardTarget | null;
  onClose: () => void;
}) {
  if (!target) return null;
  return <Card key={target.id} target={target} onClose={onClose} />;
}

function EventRow({ event, onNavigate }: { event: OrganizerEvent; onNavigate: () => void }) {
  return (
    <li>
      <Link href={`/tournament/${event.slug}`} className={styles.row} onClick={onNavigate}>
        <span className={styles.rowMain}>
          <span className={styles.rowTitle}>
            {event.title}
            {event.live && <span className={styles.liveTag}>Live</span>}
            {event.cancelled && <span className={styles.cancelledTag}>Cancelled</span>}
          </span>
          <span className={styles.rowMeta}>
            <Calendar size={13} aria-hidden="true" />
            {event.dateLabel}
          </span>
          <span className={styles.rowMeta}>
            <MapPin size={13} aria-hidden="true" />
            {event.location}
          </span>
        </span>

        {/* The count is the right-hand answer to "how big was this" —
            given a word as well as a number, because a bare figure beside
            a date reads like part of the date. */}
        <span className={styles.rowCount}>
          <span className={styles.rowCountNum}>{event.teams}</span>
          <span className={styles.rowCountLabel}>
            {event.teams === 1 ? 'team' : 'teams'}
          </span>
        </span>
      </Link>
    </li>
  );
}

function Card({ target, onClose }: { target: OrganizerCardTarget; onClose: () => void }) {
  const [card, setCard] = useState<OrganizerCard | null>(null);
  const [state, setState] = useState<'loading' | 'idle' | 'error'>('loading');
  const [tab, setTab] = useState<Tab>('upcoming');

  const organizerId = target.id;

  useEffect(() => {
    let cancel = false;

    fetch(`/api/organizers/${organizerId}`)
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (cancel) return;
        if (!res.ok) { setState('error'); return; }
        setCard(body.card as OrganizerCard);
        setState('idle');
      })
      .catch(() => { if (!cancel) setState('error'); });

    return () => { cancel = true; };
  }, [organizerId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const name = card?.name || target.name;
  const avatarUrl = card?.avatarUrl || target.avatarUrl;
  const events = card ? (tab === 'upcoming' ? card.upcoming : card.past) : [];

  return (
    <div
      className={styles.overlay}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`${name} — organizer`}
    >
      <div className={styles.dialog}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        <div className={styles.identity}>
          <Avatar name={name} src={avatarUrl} size={72} />
          <div className={styles.identityText}>
            <span className={styles.label}>Organizer</span>
            <h2 className={styles.name}>{name}</h2>
            {card?.hometown && (
              <p className={styles.hometown}>
                <MapPin size={14} aria-hidden="true" />
                {card.hometown}
              </p>
            )}
          </div>
        </div>

        {card?.whatsappUrl && (
          <a
            className={styles.whatsapp}
            href={card.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle size={16} aria-hidden="true" />
            Chat on WhatsApp
          </a>
        )}

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'upcoming'}
            className={`${styles.tab} ${tab === 'upcoming' ? styles.tabActive : ''}`}
            onClick={() => setTab('upcoming')}
          >
            Upcoming
            {card && card.upcoming.length > 0 && (
              <span className={styles.tabCount}>{card.upcoming.length}</span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'past'}
            className={`${styles.tab} ${tab === 'past' ? styles.tabActive : ''}`}
            onClick={() => setTab('past')}
          >
            History
            {card && card.past.length > 0 && (
              <span className={styles.tabCount}>{card.past.length}</span>
            )}
          </button>
        </div>

        {state === 'loading' && <p className={styles.note}>Loading…</p>}
        {state === 'error' && <p className={styles.note}>Could not load this organizer.</p>}

        {state === 'idle' && events.length === 0 && (
          <div className={styles.empty}>
            <Users size={24} aria-hidden="true" />
            <span>
              {tab === 'upcoming'
                ? 'No events coming up'
                : 'No events run yet'}
            </span>
          </div>
        )}

        {state === 'idle' && events.length > 0 && (
          <ul className={styles.list}>
            {events.map(event => (
              <EventRow key={event.slug} event={event} onNavigate={onClose} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
