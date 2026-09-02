'use client';

import { useEffect, useState } from 'react';
import { Globe, X, ArrowRight, Check } from 'lucide-react';
import styles from './PublishTournamentModal.module.css';

interface Props {
  open: boolean;
  tournamentTitle: string;
  tournamentSlug: string;
  onClose: () => void;
  onPublished: () => void;
}

export default function PublishTournamentModal({
  open,
  tournamentTitle,
  tournamentSlug,
  onClose,
  onPublished,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setError('');
      setBusy(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const handlePublish = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/tournaments/${tournamentSlug}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: 2 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to publish tournament');
      }
      onPublished();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish tournament');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={() => !busy && onClose()}>
      <div className={styles.modalDialog} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="publish-modal-title">
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          disabled={busy}
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <div className={styles.iconCircle}>
          <Globe size={26} />
        </div>

        <h2 id="publish-modal-title" className={styles.title}>Publish Tournament</h2>
        <div className={styles.tournamentName}>{tournamentTitle || 'Untitled Tournament'}</div>

        <p className={styles.description}>
          Publishing makes this tournament visible on the public Live Bracket directory, homepage, and search.
        </p>

        <div className={styles.bullets}>
          <div className={styles.bulletItem}>
            <span className={styles.bulletDot} />
            <span>Players and spectators will be able to discover the event and view divisions.</span>
          </div>
          <div className={styles.bulletItem}>
            <span className={styles.bulletDot} />
            <span>Registration will open automatically according to each division&apos;s configured dates.</span>
          </div>
          <div className={styles.bulletItem}>
            <span className={styles.bulletDot} />
            <span>You can continue updating schedule, courts, rules, and divisions at any time.</span>
          </div>
        </div>

        {error && <div className={styles.errorBanner}>{error}</div>}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btnCancel}
            onClick={onClose}
            disabled={busy}
          >
            Keep as Draft
          </button>
          <button
            type="button"
            className={styles.btnPublish}
            onClick={handlePublish}
            disabled={busy}
          >
            {busy ? (
              'Publishing…'
            ) : (
              <>
                <Globe size={16} /> Publish Tournament
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
