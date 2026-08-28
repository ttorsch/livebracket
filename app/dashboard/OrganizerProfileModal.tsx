'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import type { OrganizerIdentity } from '@/lib/session';
import styles from './OrganizerProfileModal.module.css';

/* Editing the organizer profile — the name, location and photo that
 * appear on this organizer's public event pages.
 *
 * Deliberately not the player profile at /profile. The same account can
 * hold both, and they are kept apart: this writes only the organizers
 * row (PATCH /api/organizer), and nothing here reads or falls back to
 * the player's values. An organizer who has not set a photo shows their
 * initials, not the picture from their roster profile. */

interface Props {
  open: boolean;
  organizer: OrganizerIdentity | null;
  onClose: () => void;
  onSaved: (organizer: OrganizerIdentity) => void;
}

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '·';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/* The closed modal renders nothing, so the form below only exists while
 * it is open — which is what makes "reopening discards an abandoned edit"
 * true without an effect that resets six pieces of state on every open. */
export default function OrganizerProfileModal({ open, organizer, onClose, onSaved }: Props) {
  if (!open) return null;
  return <OrganizerProfileForm organizer={organizer} onClose={onClose} onSaved={onSaved} />;
}

function OrganizerProfileForm({
  organizer,
  onClose,
  onSaved,
}: Omit<Props, 'open'>) {
  const { refresh } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(organizer?.name ?? '');
  const [hometown, setHometown] = useState(organizer?.hometown ?? '');
  /* The chosen file is held until Save so closing without saving leaves
   * nothing behind — and so a failed name validation does not strand an
   * uploaded image on the account. */
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Object URLs are only freed by hand.
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pickFile = (chosen: File | undefined) => {
    if (!chosen) return;
    setFile(chosen);
    setPreview(URL.createObjectURL(chosen));
    setRemoveImage(false);
    setError(null);
  };

  const shownImage = preview ?? (removeImage ? null : organizer?.avatarUrl ?? null);

  const save = async () => {
    if (saving) return;
    if (!name.trim()) {
      setError('An organizer name is required.');
      return;
    }
    setSaving(true);
    setError(null);

    try {
      /* Upload first: the URL has to exist before it can be stored, and a
       * failure here should stop the save rather than write a broken
       * reference. The upload route only returns a URL — it writes to no
       * table, so nothing is committed until the PATCH below. */
      let avatarUrl: string | undefined;
      if (file) {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/me/avatar', { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Could not upload the image');
        avatarUrl = data.url as string;
      } else if (removeImage) {
        avatarUrl = '';
      }

      const res = await fetch('/api/organizer', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          hometown: hometown.trim(),
          ...(avatarUrl !== undefined ? { avatarUrl } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not save your profile');

      const saved = data.organizer;
      onSaved({
        id: saved.id,
        name: saved.name ?? null,
        hometown: saved.hometown ?? null,
        club: saved.club ?? null,
        avatarUrl: saved.avatar_url ?? null,
      });
      /* The header reads the session, so it has to hear about this too. */
      await refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div
        className={styles.dialog}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Organizer profile"
      >
        <div className={styles.head}>
          <div className={styles.headText}>
            <h2 className={styles.title}>Organizer profile</h2>
            <span className={styles.subtitle}>
              How you appear on your public event pages. Separate from your player profile.
            </span>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className={styles.avatarRow}>
          <button
            type="button"
            className={styles.avatarButton}
            onClick={() => fileRef.current?.click()}
            aria-label="Change organizer photo"
          >
            {shownImage ? (
              // Uploaded to Supabase storage, whose host next/image would
              // need declared in next.config.ts.
              <img src={shownImage} alt="" className={styles.avatarImage} />
            ) : (
              <span>{initialsFor(name || organizer?.name || '')}</span>
            )}
            <span className={styles.avatarOverlay}><Camera size={20} /></span>
          </button>

          <div className={styles.avatarHint}>
            <span className={styles.avatarHintTitle}>Organizer photo</span>
            <span className={styles.avatarHintText}>
              PNG, JPEG or WebP, up to 5MB. Shown beside your events.
            </span>
            {shownImage && (
              <button
                type="button"
                className={styles.avatarRemove}
                onClick={() => { setFile(null); setPreview(null); setRemoveImage(true); }}
              >
                Remove photo
              </button>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={e => pickFile(e.target.files?.[0])}
          />
        </div>

        <div className={styles.fields}>
          <label className={styles.field}>
            <span className={styles.label}>
              Name <span className={styles.required}>*</span>
            </span>
            <input
              className={styles.input}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Khao Lak Volley"
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Location</span>
            <input
              className={styles.input}
              value={hometown}
              onChange={e => setHometown(e.target.value)}
              placeholder="e.g. Khao Lak, Thailand"
            />
          </label>
        </div>

        {error && <span className={styles.error}>{error}</span>}

        <div className={styles.footer}>
          <button type="button" className={styles.btnGhost} onClick={onClose}>Cancel</button>
          <button type="button" className={styles.btnPrimary} onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </div>
    </div>
  );
}
