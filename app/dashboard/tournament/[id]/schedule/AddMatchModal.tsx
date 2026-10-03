'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import styles from './page.module.css';

/* The organizer's "Add match": a special match — an exhibition outside the
 * competition — drawn as the card it will become. Time, pool, round and match
 * number are blank because a special match has none of them yet (it lands in
 * the Unscheduled tray to be placed) or ever (it is in no pool, round or
 * numbering). What can be set is set in place: the length on the card's top
 * row, and each team on its own row, from the tournament's teams or typed in
 * as a new name that exists for this match alone. */

export interface AddMatchTeamOption {
  id: string;
  name: string;
  division: string;
}

type SideChoice = { teamId: string } | { label: string };

const NEW_TEAM = '__new__';
const DEFAULT_MINUTES = 30;

function SideRow({
  side,
  teams,
  otherTeamId,
  value,
  onChange,
}: {
  side: 'A' | 'B';
  teams: AddMatchTeamOption[];
  otherTeamId: string | null;
  value: { pick: string; label: string };
  onChange: (next: { pick: string; label: string }) => void;
}) {
  const divisions = [...new Set(teams.map(t => t.division))];
  const labelRef = useRef<HTMLInputElement>(null);
  const isNew = value.pick === NEW_TEAM;

  // Choosing "New team" is choosing to type, so the cursor goes there.
  useEffect(() => {
    if (isNew) labelRef.current?.focus();
  }, [isNew]);

  return (
    <div className={styles.addMatchSide}>
      <select
        className={styles.addMatchSelect}
        value={value.pick}
        onChange={e => onChange({ ...value, pick: e.target.value })}
        aria-label={`Team ${side}`}
      >
        <option value="" disabled>
          Choose team {side}
        </option>
        {divisions.map(div => (
          <optgroup key={div} label={div}>
            {teams
              .filter(t => t.division === div)
              .map(t => (
                <option key={t.id} value={t.id} disabled={t.id === otherTeamId}>
                  {t.name}
                </option>
              ))}
          </optgroup>
        ))}
        <option value={NEW_TEAM}>+ New team…</option>
      </select>
      {isNew && (
        <input
          ref={labelRef}
          className={styles.addMatchInput}
          type="text"
          maxLength={80}
          placeholder="Type the team name"
          value={value.label}
          onChange={e => onChange({ ...value, label: e.target.value })}
          aria-label={`New team ${side} name`}
        />
      )}
    </div>
  );
}

export function AddMatchModal({
  slug,
  teams,
  onClose,
  onAdded,
}: {
  slug: string;
  teams: AddMatchTeamOption[];
  onClose: () => void;
  onAdded: (matchId: string) => void;
}) {
  const [a, setA] = useState({ pick: '', label: '' });
  const [b, setB] = useState({ pick: '', label: '' });
  const [minutes, setMinutes] = useState(String(DEFAULT_MINUTES));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const choice = (v: { pick: string; label: string }): SideChoice | null => {
    if (v.pick === NEW_TEAM) return v.label.trim() ? { label: v.label.trim() } : null;
    return v.pick ? { teamId: v.pick } : null;
  };
  const sideA = choice(a);
  const sideB = choice(b);
  const duration = Number(minutes);
  const durationOk = Number.isFinite(duration) && duration >= 5 && duration <= 240;
  const ready = !!sideA && !!sideB && durationOk && !saving;

  const submit = async () => {
    if (!sideA || !sideB) {
      setError('Pick a team for both sides, or type a name for a new one.');
      return;
    }
    if (!durationOk) {
      setError('A match runs between 5 and 240 minutes.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tournaments/${slug}/special-matches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamA: sideA, teamB: sideB, durationMinutes: Math.trunc(duration) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || 'Could not add the match.');
        return;
      }
      onAdded(body.matchId as string);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={styles.modalOverlay}
      role="presentation"
      onClick={e => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div className={`${styles.modalPanel} ${styles.addMatchPanel}`} role="dialog" aria-modal="true" aria-labelledby="addMatchTitle">
        <div className={styles.modalHeader}>
          <div>
            <div className={styles.modalEyebrow}>Special match</div>
            <h3 className={styles.modalTitle} id="addMatchTitle">Add match</h3>
          </div>
          <button type="button" className={styles.genHeadClose} onClick={onClose} aria-label="Close" disabled={saving}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.modalBody}>
          {/* The card it will be, at reading size. */}
          <div className={`${styles.gridMatchCard} ${styles.addMatchCard}`}>
            <div className={styles.gridMatchTop}>
              <div className={styles.gridMatchTimeWrap}>
                <span className={styles.gridMatchTime}>—</span>
              </div>
              <span className={styles.gridMatchTags}>
                <label className={styles.addMatchDuration}>
                  <input
                    type="number"
                    min={5}
                    max={240}
                    step={5}
                    value={minutes}
                    onChange={e => setMinutes(e.target.value)}
                    aria-label="Match length in minutes"
                  />
                  <span>m</span>
                </label>
              </span>
            </div>
            <div className={styles.gridMatchTeams}>
              <SideRow
                side="A"
                teams={teams}
                otherTeamId={b.pick && b.pick !== NEW_TEAM ? b.pick : null}
                value={a}
                onChange={setA}
              />
              <SideRow
                side="B"
                teams={teams}
                otherTeamId={a.pick && a.pick !== NEW_TEAM ? a.pick : null}
                value={b}
                onChange={setB}
              />
            </div>
          </div>

          <p className={styles.addMatchNote}>
            An exhibition — it doesn&rsquo;t count toward standings, the bracket or player records.
            It lands in <strong>Unscheduled</strong>; drag it onto a court to give it a time.
          </p>
          {error && <p className={styles.addMatchError}>{error}</p>}

          <div className={styles.addMatchActions}>
            <button type="button" className={styles.addMatchCancel} onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="button" className={styles.addMatchSubmit} onClick={submit} disabled={!ready}>
              {saving ? 'Adding…' : 'Add match'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
