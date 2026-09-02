'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, X, ImagePlus, Trash2, ChevronDown } from 'lucide-react';
import DateRangePicker from '@/components/DateRangePicker';
import styles from './CreateTournamentModal.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

/* Which of the three exits is in flight, so only that item shows a busy
   label and the rest stay disabled. */
type PendingAction = 'draft' | 'announce' | 'detail' | null;

export default function CreateTournamentModal({ open, onClose }: Props) {
  const router = useRouter();

  // Tournament info
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [description, setDescription] = useState('');

  // Tournament image — uploaded immediately on selection, URL kept for publish.
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');

  const [submitted, setSubmitted] = useState(false);
  const [publishedSlug, setPublishedSlug] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [publishError, setPublishError] = useState('');

  const isOneDay = !endDate || startDate === endDate;
  const canAdvance = !!title.trim() && !!location.trim() && !!startDate;

  const reset = () => {
    setTitle('');
    setLocation('');
    setStartDate('');
    setEndDate('');
    setDescription('');
    setImageFile(null);
    setImagePreview('');
    setSubmitted(false);
    setPublishedSlug('');
    setPendingAction(null);
    setPublishError('');
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

  /* Click outside the menu closes it. Escape already closes the whole modal,
     which is the more useful thing to do from here. */
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const buildRecord = (extra: Record<string, unknown> = {}) => ({
    title,
    location,
    startDate,
    endDate: endDate || startDate,
    isOneDay,
    description,
    ...extra,
  });

  // Read the selected image into a local preview; actual upload happens on publish.
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  // Upload the cover image (if any) and create the tournament row. Shared by
  // "Publish" and "More detail" — both need a real DB row before this modal
  // closes, so a tournament is never lost in local-only state.
  const publishTournament = async (phase: 1 | 2): Promise<string> => {
    let imageUrl = '';
    if (imageFile) {
      const fd = new FormData();
      fd.append('file', imageFile);
      const upRes = await fetch('/api/tournaments/upload-image', { method: 'POST', body: fd });
      const upBody = await upRes.json();
      if (!upRes.ok) throw new Error(upBody.error || 'Image upload failed');
      imageUrl = upBody.url;
    }

    const res = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        location,
        startDate,
        endDate: endDate || startDate,
        isOneDay,
        description,
        imageUrl,
        phase,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Failed to publish tournament');
    return body.slug as string;
  };

  /* The three ways out of this dialog. All of them write a real row before
     the modal closes, so a tournament is never lost in local-only state;
     they differ in the phase they create and where they leave you. */
  const runAction = async (
    action: NonNullable<PendingAction>,
    phase: 1 | 2,
    thenWorkspace: boolean,
  ) => {
    if (!canAdvance || pendingAction) return;
    setMenuOpen(false);
    setPendingAction(action);
    setPublishError('');
    try {
      const slug = await publishTournament(phase);
      if (thenWorkspace) {
        try {
          sessionStorage.setItem(`lb:draft:${slug}`, JSON.stringify(buildRecord()));
        } catch {
          /* sessionStorage unavailable — proceed without the handoff payload */
        }
        router.push(`/dashboard/tournament/${slug}/setup?new=1`);
        return;
      }
      setPublishedSlug(slug);
      setSubmitted(true);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Failed to create tournament');
    } finally {
      setPendingAction(null);
    }
  };

  const saveDraft = () => runAction('draft', 1, false);
  const announce = () => runAction('announce', 2, false);
  const announceAndCreateDivision = () => runAction('detail', 2, true);

  if (!open) return null;

  return (
    <div className={styles.modalOverlay} onClick={handleClose}>
      <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
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
          <>
            <div className={styles.modalHeader}>
              <h3>Create a New Tournament</h3>
              <button type="button" className={styles.modalCloseBtn} onClick={handleClose} aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <div className={styles.modalBody}>
              {publishError && <div className={styles.modalFormError}>{publishError}</div>}

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Tournament Name *</label>
                <input
                  className={styles.input}
                  type="text"
                  placeholder="e.g. Summer Beach Open 2026"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                />
              </div>

              <div className={styles.fieldGroup} style={{ marginTop: 12 }}>
                <label className={styles.fieldLabel}>Location *</label>
                <input
                  className={styles.input}
                  type="text"
                  placeholder="e.g. Memories Beach, Khao Lak, Thailand"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                />
                <p className={styles.fieldHint}>Tip: Include venue, city, and country for best search results.</p>
              </div>

              <div className={styles.fieldGroup} style={{ marginTop: 12 }}>
                <label className={styles.fieldLabel}>Tournament dates *</label>
                <DateRangePicker
                  start={startDate}
                  end={endDate}
                  onChange={(s, e) => {
                    setStartDate(s);
                    setEndDate(e);
                  }}
                />
              </div>

              <div className={styles.fieldGroup} style={{ marginTop: 12 }}>
                <label className={styles.fieldLabel}>Description</label>
                <textarea
                  className={styles.textarea}
                  rows={3}
                  placeholder="Optional — tell players what to expect..."
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
              </div>

              <div className={styles.fieldGroup} style={{ marginTop: 12 }}>
                <label className={styles.fieldLabel}>Tournament image</label>
                {imagePreview ? (
                  <div className={styles.editImageRow}>
                    <img src={imagePreview} alt="Tournament preview" className={styles.editImageThumb} />
                    <div className={styles.editImageActions}>
                      <label className={styles.editImageBtn}>
                        <ImagePlus size={15} /> Replace
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          hidden
                          onChange={handleImageSelect}
                        />
                      </label>
                      <button
                        type="button"
                        className={styles.editImageRemove}
                        onClick={() => {
                          setImageFile(null);
                          setImagePreview('');
                        }}
                      >
                        <Trash2 size={15} /> Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className={styles.editImageEmpty}>
                    <ImagePlus size={16} /> Add cover image
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      hidden
                      onChange={handleImageSelect}
                    />
                  </label>
                )}
                <p className={styles.fieldHint}>
                  Shown on tournament cards and the event page. PNG/JPEG/WebP, max 5MB.
                </p>
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button type="button" className={styles.btnGhost} onClick={handleClose}>
                Cancel
              </button>
              <div className={styles.nextWrap} ref={menuRef}>
                <button
                  type="button"
                  className={styles.btnPrimary}
                  disabled={!canAdvance || pendingAction !== null}
                  onClick={() => setMenuOpen(v => !v)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  {pendingAction ? 'Creating…' : 'Next'}
                  <ChevronDown
                    size={16}
                    className={`${styles.nextChevron} ${menuOpen ? styles.nextChevronOpen : ''}`}
                  />
                </button>

                {menuOpen && (
                  <div className={styles.nextMenu} role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.nextMenuItem}
                      onClick={saveDraft}
                      disabled={pendingAction !== null}
                    >
                      <span className={styles.nextMenuLabel}>Save as draft</span>
                      <span className={styles.nextMenuHint}>Only you can see it</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.nextMenuItem}
                      onClick={announce}
                      disabled={pendingAction !== null}
                    >
                      <span className={styles.nextMenuLabel}>Announce</span>
                      <span className={styles.nextMenuHint}>Players see the date, no divisions yet</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.nextMenuItem}
                      onClick={announceAndCreateDivision}
                      disabled={pendingAction !== null}
                    >
                      <span className={styles.nextMenuLabel}>Announce and Create division</span>
                      <span className={styles.nextMenuHint}>Go straight to setup</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
