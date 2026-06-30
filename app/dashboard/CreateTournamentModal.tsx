'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';
import styles from './create/page.module.css';

/* Build a URL-safe slug from the tournament title. */
function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `tournament-${Date.now()}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CreateTournamentModal({ open, onClose }: Props) {
  const router = useRouter();

  // Tournament info
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isOneDay, setIsOneDay] = useState(false);
  const [description, setDescription] = useState('');

  // Registration Schedule
  const [regOpenDate, setRegOpenDate] = useState('');
  const [regOpenTBA, setRegOpenTBA] = useState(true);
  const [regCloseDate, setRegCloseDate] = useState('');
  const [regCloseTBA, setRegCloseTBA] = useState(true);

  const [submitted, setSubmitted] = useState(false);
  const [publishedSlug, setPublishedSlug] = useState('');

  const canAdvance = !!title.trim() && !!location.trim() && !!startDate;

  const reset = () => {
    setTitle('');
    setLocation('');
    setStartDate('');
    setEndDate('');
    setIsOneDay(false);
    setDescription('');
    setRegOpenDate('');
    setRegOpenTBA(true);
    setRegCloseDate('');
    setRegCloseTBA(true);
    setSubmitted(false);
    setPublishedSlug('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const buildRecord = (extra: Record<string, unknown> = {}) => ({
    title,
    location,
    startDate,
    endDate,
    isOneDay,
    description,
    regOpenDate,
    regOpenTBA,
    regCloseDate,
    regCloseTBA,
    ...extra,
  });

  // Carry the entered info into the workspace as an unpublished draft.
  const goToWorkspace = () => {
    if (!canAdvance) return;
    const slug = slugify(title);
    try {
      sessionStorage.setItem(`lb:draft:${slug}`, JSON.stringify(buildRecord()));
    } catch {
      /* sessionStorage unavailable — proceed without the handoff payload */
    }
    router.push(`/dashboard/tournament/${slug}/setup?new=1`);
  };

  // Publish straight away with a "Details coming soon" status (no setup needed).
  const publishNow = () => {
    if (!canAdvance) return;
    const slug = slugify(title);
    const record = buildRecord({ published: true, status: 'coming-soon' });
    try {
      sessionStorage.setItem(`lb:draft:${slug}`, JSON.stringify(record));
      sessionStorage.setItem(`lb:published:${slug}`, JSON.stringify(record));
    } catch {
      /* sessionStorage unavailable — still show confirmation */
    }
    setPublishedSlug(slug);
    setSubmitted(true);
  };

  if (!open) return null;

  return (
    <div className={styles.modalOverlay} onClick={handleClose}>
      <div className={styles.modalDialog} onClick={e => e.stopPropagation()}>
        <button type="button" className={styles.modalClose} onClick={handleClose} aria-label="Close">
          <X size={18} />
        </button>

        {submitted ? (
          <div className={styles.modalSuccess}>
            <div className={styles.successIcon}><Check size={32} strokeWidth={3} /></div>
            <h2 className={styles.successTitle}>Tournament published!</h2>
            <p className={styles.successSub}>
              <strong>{title}</strong> is now live with a <strong>“Details coming soon”</strong> status.
              Players can see the date and save it — add divisions and registration whenever you&apos;re ready.
            </p>
            <div className={styles.successActions}>
              <Link href={`/tournament/${publishedSlug}`} className={styles.btnPrimary} style={{ justifyContent: 'center' }}>
                View tournament page
              </Link>
              <Link href={`/dashboard/tournament/${publishedSlug}/setup`} className={styles.btnOutline} style={{ justifyContent: 'center' }}>
                Add details now
              </Link>
              <button type="button" className={styles.btnGhost} style={{ justifyContent: 'center' }} onClick={handleClose}>
                Go to dashboard
              </button>
            </div>
          </div>
        ) : (
          <div>
            <h2 className={styles.stepTitle}>Create a New Tournament</h2>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Tournament name *</label>
              <input className={styles.input} type="text" value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Location *</label>
              <input className={styles.input} type="text" placeholder="e.g. Memories Beach, Khao Lak, Thailand" value={location} onChange={e => setLocation(e.target.value)} />
              <p className={styles.fieldHint}>Tip: Include venue, city, and country for best search results.</p>
            </div>

            <div className={styles.twoCol}>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Start date *</label>
                <input
                  className={styles.input}
                  type="date"
                  value={startDate}
                  onChange={e => {
                    setStartDate(e.target.value);
                    if (isOneDay) setEndDate(e.target.value);
                  }}
                />
                <label className={styles.switchRow}>
                  <span className={styles.switch}>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={isOneDay}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setIsOneDay(checked);
                        if (checked && startDate) setEndDate(startDate);
                      }}
                    />
                    <span className={styles.switchTrack}>
                      <span className={styles.switchThumb} />
                    </span>
                  </span>
                  <span className={styles.switchText}>One-Day Tournament</span>
                </label>
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>End date</label>
                <input
                  className={styles.input}
                  type="date"
                  disabled={isOneDay}
                  value={isOneDay ? startDate : endDate}
                  onChange={e => setEndDate(e.target.value)}
                />
              </div>
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Description</label>
              <textarea className={styles.textarea} rows={3} placeholder="Optional — tell players what to expect..." value={description} onChange={e => setDescription(e.target.value)} />
            </div>

            <div className={styles.stepFooter} style={{ marginTop: 32 }}>
              <button type="button" className={styles.btnGhost} onClick={handleClose}>
                Cancel
              </button>
              <div className={styles.actionGroup}>
                <button
                  type="button"
                  className={styles.btnOutline}
                  disabled={!canAdvance}
                  onClick={goToWorkspace}
                >
                  More detail
                </button>
                <button
                  type="button"
                  className={styles.btnPrimary}
                  disabled={!canAdvance}
                  onClick={publishNow}
                >
                  Publish
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
