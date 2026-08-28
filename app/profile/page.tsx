'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { Camera, Shield, MapPin } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  DateChip,
  Icon,
  Logo,
  MatchCard,
  SegmentedControl,
} from '@/components/livebracket-ds';
import styles from './page.module.css';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/auth/AuthProvider';
import { isOrganizer as hasOrganizerRole } from '@/lib/session';
import type { MyRegistration } from '@/app/api/me/registrations/route';

/* Built to Profile.dc.html from the Live Bracket design project, using the
 * vendored design system rather than a port of the artboard's markup —
 * every component the design imports (Card, Badge, Avatar, MatchCard,
 * SegmentedControl…) already exists in components/livebracket-ds.
 *
 * What is real and what is not, so the next person does not have to guess:
 *
 *   real     — the identity block, My Events, Next Up, the payment banner
 *              and the division badges, all from the account's own
 *              registrations (GET /api/me/registrations).
 *   sample   — Recent Results, Partners, Performance and Starred. These
 *              need match results and a starred-events table, neither of
 *              which exists yet. Kept as the design drew them so the page
 *              reads as designed, and labelled in the UI.
 *   blank    — Wins and Win rate render as em dashes. A fabricated number
 *              sitting beside a real one is worse than an obvious gap.
 */

/* ── Sample data ─────────────────────────────────────────────────── */

const SAMPLE_PLAYER = {
  location: 'Khao Lak, Thailand',
  since: 'Jan 2024',
};

const SAMPLE_MATCHES = [
  {
    round: 'Khao Lak Open 2026 · Final',
    teamA: { name: 'Tor / Niran', sets: [21, 19, 15], score: 2 },
    teamB: { name: 'Lukas / Felix', sets: [18, 21, 11], score: 1 },
  },
  {
    round: 'Khao Lak Open 2026 · Semifinal',
    teamA: { name: 'Tor / Niran', sets: [21, 21], score: 2 },
    teamB: { name: 'Aroon / Kit', sets: [17, 19], score: 0 },
  },
  {
    round: 'Sunset Shootout 3v3 · Quarterfinal',
    teamA: { name: 'Ploy / Mali', sets: [21, 21], score: 2 },
    teamB: { name: 'Tor / Dao', sets: [19, 16], score: 0 },
  },
];

const SAMPLE_PARTNERS = [
  { name: 'Niran Chaiwat', meta: 'Men Open · 5 tournaments', record: '12–4', pct: '75%' },
  { name: 'Dao Pitsanu', meta: 'Mixed · 2 tournaments', record: '5–5', pct: '50%' },
  { name: 'Kit Anurak', meta: 'Men B · 1 tournament', record: '2–3', pct: '40%' },
];

const SAMPLE_STARRED = [
  { id: 'khao-lak-open-2027', name: 'Khao Lak Open 2027', place: 'Memories Beach · Phang Nga', dates: 'Mar 13 – Mar 14, 2027', status: 'Live', badgeVariant: 'live' as const, action: 'Watch live' },
  { id: 'andaman-masters', name: 'Andaman Masters', place: 'Nang Thong Beach', dates: 'Nov 21 – Nov 22, 2026', status: 'Registration', badgeVariant: 'highlight' as const, action: 'Register Team' },
  { id: 'bang-niang-doubles', name: 'Bang Niang Doubles', place: 'Bang Niang Beach', dates: 'Jan 23, 2027', status: 'Upcoming', badgeVariant: 'status' as const, action: 'View details' },
];

/* ── Helpers ─────────────────────────────────────────────────────── */

type Tab = 'overview' | 'events' | 'starred';

const TABS = [
  { label: 'Overview', value: 'overview' },
  { label: 'My Events', value: 'events' },
  { label: 'Starred', value: 'starred' },
];

/* "Oct 3 – Oct 4, 2026", collapsing a one-day event to a single date and a
   same-month range to one month name. Read in UTC to match the rest of the
   app: a browser west of Greenwich would otherwise show a day early. */
function formatEventDates(startDate: string, endDate: string | null): string {
  const day = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
  };
  const start = day(startDate);
  if (!start) return '';
  const end = endDate ? day(endDate) : null;
  const utc: Intl.DateTimeFormatOptions = { timeZone: 'UTC' };

  if (!end || end.getTime() === start.getTime()) {
    return start.toLocaleDateString('en-US', { ...utc, month: 'short', day: 'numeric', year: 'numeric' });
  }
  const sameMonth =
    start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear();
  const left = start.toLocaleDateString('en-US', { ...utc, month: 'short', day: 'numeric' });
  const right = end.toLocaleDateString('en-US', sameMonth
    ? { ...utc, day: 'numeric', year: 'numeric' }
    : { ...utc, month: 'short', day: 'numeric', year: 'numeric' });
  return `${left} – ${right}`;
}

/* What the player needs to know about an entry at a glance: whether their
   slot is real, and whether they still owe for it. Waitlist outranks the
   payment state — there is no slot yet to have paid for. */
function registrationStatus(reg: MyRegistration): {
  label: string;
  variant: 'live' | 'highlight' | 'status' | 'outline';
} {
  if (reg.status === 'waitlist') return { label: 'Waitlisted', variant: 'outline' };
  if (reg.paid) return { label: 'Paid', variant: 'status' };
  if (reg.fee > 0) return { label: 'Payment Due', variant: 'highlight' };
  return { label: 'Registered', variant: 'status' };
}

/* An event is "upcoming" through its final day, so one being played today
   does not drop into the past half of the list. */
function isUpcoming(reg: MyRegistration): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return (reg.endDate ?? reg.startDate) >= today;
}

const money = new Intl.NumberFormat('en-US');

/* ── Page ────────────────────────────────────────────────────────── */

export default function PlayerProfile() {
  const [tab, setTab] = useState<Tab>('overview');

  /* Who is signed in arrives with the page, resolved on the server in
   * app/layout.tsx and handed down by AuthProvider. */
  const { session, refresh: refreshAuth } = useAuth();
  const isOrganizer = hasOrganizerRole(session);
  const displayName = session.name?.trim() || session.email?.split('@')[0] || 'Your profile';

  // ── Profile Edit State ──────────────────────────────────────────
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(displayName);
  const [editClub, setEditClub] = useState(session.club ?? '');
  const [editHometown, setEditHometown] = useState(session.hometown ?? '');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) {
      setEditName(session.name?.trim() || session.email?.split('@')[0] || '');
      setEditClub(session.club ?? '');
      setEditHometown(session.hometown ?? '');
      setAvatarPreview(null);
      setSelectedFile(null);
      setEditError(null);
    }
  }, [session, isEditing]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setEditError('Please select a valid image file (PNG, JPEG, WebP, GIF)');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setEditError('Image must be 5MB or smaller');
      return;
    }
    setSelectedFile(file);
    setEditError(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      setAvatarPreview(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) {
      setEditError('Name cannot be empty');
      return;
    }
    setSaving(true);
    setEditError(null);

    try {
      let uploadedAvatarUrl = session.avatarUrl;

      // Upload new avatar if file was selected
      if (selectedFile) {
        const formData = new FormData();
        formData.append('file', selectedFile);
        const uploadRes = await fetch('/api/me/avatar', {
          method: 'POST',
          body: formData,
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) {
          throw new Error(uploadData.error || 'Failed to upload photo');
        }
        uploadedAvatarUrl = uploadData.url;
      }

      // Update name, avatar, club & hometown
      const updateRes = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          avatarUrl: uploadedAvatarUrl,
          club: editClub.trim(),
          hometown: editHometown.trim(),
        }),
      });
      const updateData = await updateRes.json();
      if (!updateRes.ok) {
        throw new Error(updateData.error || 'Failed to update profile');
      }

      await refreshAuth();
      setIsEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const [registrations, setRegistrations] = useState<MyRegistration[]>([]);
  const [regsLoading, setRegsLoading] = useState(true);
  const [regsError, setRegsError] = useState<string | null>(null);

  useEffect(() => {
    /* Scoped to the session on the server, so there is no id to pass and
     * none that would be trusted if there were. */
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/me/registrations', { cache: 'no-store' });
        if (!res.ok) throw new Error('Could not load your events');
        const data = await res.json();
        if (!cancelled) setRegistrations(data.registrations ?? []);
      } catch (err) {
        if (!cancelled) setRegsError(err instanceof Error ? err.message : 'Could not load your events');
      } finally {
        if (!cancelled) setRegsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const upcoming = useMemo(() => registrations.filter(isUpcoming), [registrations]);
  const past = useMemo(() => registrations.filter(r => !isUpcoming(r)), [registrations]);

  /* Ascending, so "next up" is the nearest event rather than the furthest. */
  const nextUp = useMemo(
    () => [...upcoming].sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null,
    [upcoming],
  );

  const tournamentCount = useMemo(
    () => new Set(registrations.map(r => r.slug)).size,
    [registrations],
  );

  /* The banner earns its place only when there is something to act on: an
   * upcoming entry, holding a real slot, with a fee still outstanding. */
  const paymentDue = useMemo(
    () => upcoming.find(r => r.fee > 0 && !r.paid && r.status !== 'waitlist') ?? null,
    [upcoming],
  );

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      /* Clearing the browser session is only half of it — the auth cookie
       * has to go too, or middleware and every server component keep
       * treating this visitor as signed in. */
      await fetch('/api/auth/signout', { method: 'POST' });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      window.location.href = '/';
    }
  };

  return (
    <div className={styles.page}>
      {/* ── Top bar ───────────────────────────────────────────────── */}
      <div className={`${styles.shell} ${styles.topbar}`}>
        <Link href="/" className={styles.brand} aria-label="Live Bracket — home">
          <Logo variant="lockup" size={30} />
        </Link>
        <div className={styles.topbarActions}>
          <button
            type="button"
            className={styles.topbarLink}
            onClick={() => {}}
          >
            Settings
          </button>
          <button
            type="button"
            className={styles.topbarLink}
            onClick={handleLogout}
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* ── Identity ──────────────────────────────────────────────── */}
      <div className={`${styles.shell} ${styles.identity}`}>
        {isEditing ? (
          <form className={styles.editContainer} onSubmit={handleSaveProfile}>
            <div className={styles.avatarUploadCol}>
              <div
                className={styles.avatarUpload}
                onClick={() => fileInputRef.current?.click()}
                title="Click to choose a new photo"
              >
                <Avatar
                  name={editName || displayName}
                  src={avatarPreview ?? (session.avatarUrl ?? undefined)}
                  size={96}
                />
                <div className={styles.avatarUploadOverlay}>
                  <Camera size={20} />
                  <span>Change</span>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <button
                type="button"
                className={styles.avatarChangeLabel}
                onClick={() => fileInputRef.current?.click()}
              >
                Change photo
              </button>
            </div>

            <div className={styles.editForm}>
              <div className={styles.editFieldGroup}>
                <label className={styles.editLabel} htmlFor="profile-fullname">
                  Full name
                </label>
                <input
                  id="profile-fullname"
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className={styles.editInput}
                  placeholder="Your full name"
                  disabled={saving}
                  autoFocus
                  required
                />
              </div>

              <div className={styles.editRow}>
                <div className={styles.editFieldGroup}>
                  <label className={styles.editLabel} htmlFor="profile-club">
                    Club
                  </label>
                  <input
                    id="profile-club"
                    type="text"
                    value={editClub}
                    onChange={(e) => setEditClub(e.target.value)}
                    className={styles.editInputSmall}
                    placeholder="e.g. Khao Lak Volley"
                    disabled={saving}
                  />
                </div>
                <div className={styles.editFieldGroup}>
                  <label className={styles.editLabel} htmlFor="profile-hometown">
                    Hometown
                  </label>
                  <input
                    id="profile-hometown"
                    type="text"
                    value={editHometown}
                    onChange={(e) => setEditHometown(e.target.value)}
                    className={styles.editInputSmall}
                    placeholder="e.g. Khao Lak, Thailand"
                    disabled={saving}
                  />
                </div>
              </div>

              {editError && <div className={styles.editError}>{editError}</div>}

              <div className={styles.editActions}>
                <button
                  type="submit"
                  disabled={saving}
                  className={styles.btnSave}
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  disabled={saving}
                  className={styles.btnCancel}
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className={styles.identityLeft}>
            <Avatar name={displayName} src={session.avatarUrl ?? undefined} size={96} />
            <div className={styles.identityText}>
              <div className={styles.nameRow}>
                <h1 className={styles.name}>{displayName}</h1>
              </div>
              <div className={styles.metaRow}>
                {session.club && (
                  <span className={styles.metaItem}>
                    <Shield size={16} color="var(--color-primary)" />
                    {session.club}
                  </span>
                )}
                {(session.hometown || SAMPLE_PLAYER.location) && (
                  <span className={styles.metaItem}>
                    <MapPin size={16} color="var(--color-primary)" />
                    {session.hometown || SAMPLE_PLAYER.location}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        <div className={styles.identityRight}>
          {!isEditing && (
            <button
              type="button"
              className={styles.editProfileBtn}
              onClick={() => setIsEditing(true)}
            >
              Edit Profile
            </button>
          )}
          <div className={styles.statRow}>
            <div className={styles.stat}>
              <span className={styles.statNum}>{regsLoading ? '–' : tournamentCount}</span>
              <span className={styles.statLabel}>Tournaments</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.stat}>
              {/* Needs finalized match results — see the note at the top. */}
              <span className={styles.statNumEmpty} title="Not available yet">—</span>
              <span className={styles.statLabel}>Wins</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.stat}>
              <span className={styles.statNumEmpty} title="Not available yet">—</span>
              <span className={styles.statLabel}>Win rate</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────── */}
      <div className={styles.shell}>
        <SegmentedControl
          options={TABS}
          value={tab}
          onChange={value => setTab(value as Tab)}
        />
      </div>

      {/* ── Content ───────────────────────────────────────────────── */}
      <div className={`${styles.shell} ${styles.content}`}>

        {/* Payment banner — real, and only when something is owed. */}
        {paymentDue && tab !== 'starred' && (
          <Card radius="lg" padding={20}>
            <div className={styles.payRow}>
              <span className={styles.payIcon}>
                <Icon name="calendar" size={21} color="var(--ink-900)" />
              </span>
              <div className={styles.payText}>
                <span className={styles.payTitle}>Entry fee due for {paymentDue.title}</span>
                <span className={styles.paySub}>
                  {paymentDue.divisionName} · Pay the organizer to keep your spot in the draw
                </span>
              </div>
              <div className={styles.payRight}>
                <span className={styles.payAmount}>฿{money.format(paymentDue.fee)}</span>
                <Link href={`/tournament/${paymentDue.slug}`}>
                  <Button variant="primary">View event</Button>
                </Link>
              </div>
            </div>
          </Card>
        )}

        {/* ── Overview ────────────────────────────────────────────── */}
        {tab === 'overview' && (
          <div className={styles.overviewGrid}>
            <div className={styles.col}>
              <Card radius="xl" padding={24}>
                <div className={styles.cardHead}>
                  <h2 className={styles.cardTitle}>Recent Results</h2>
                  <span className={styles.cardNote}>Sample data</span>
                </div>
                <div className={styles.matchList}>
                  {SAMPLE_MATCHES.map(m => (
                    <MatchCard
                      key={m.round}
                      round={m.round}
                      teamA={m.teamA}
                      teamB={m.teamB}
                      style={{ boxShadow: 'none', background: 'var(--sand-100)', padding: 16 }}
                    />
                  ))}
                </div>
              </Card>

              <Card radius="xl" padding={24}>
                <div className={styles.cardHeadTight}>
                  <h2 className={styles.cardTitle}>Partners</h2>
                  <span className={styles.cardNote}>Sample data</span>
                </div>
                {SAMPLE_PARTNERS.map(p => (
                  <div key={p.name} className={styles.partnerRow}>
                    <Avatar name={p.name} size={36} />
                    <div className={styles.partnerText}>
                      <span className={styles.partnerName}>{p.name}</span>
                      <span className={styles.partnerMeta}>{p.meta}</span>
                    </div>
                    <span className={styles.partnerRecord}>{p.record}</span>
                    <div className={styles.partnerBar}>
                      <div className={styles.partnerBarFill} style={{ width: p.pct }} />
                    </div>
                    <span className={styles.partnerPct}>{p.pct}</span>
                  </div>
                ))}
              </Card>
            </div>

            <div className={styles.col}>
              <Card radius="xl" padding={24}>
                <h2 className={styles.cardTitleSpaced}>Next Up</h2>
                {regsLoading && <div className={styles.skeleton} />}
                {!regsLoading && !nextUp && (
                  <div className={styles.emptyState}>
                    <span>No upcoming events</span>
                    <Link href="/" className={styles.emptyLink}>Find a tournament</Link>
                  </div>
                )}
                {!regsLoading && nextUp && (
                  <div className={styles.nextUp}>
                    <div className={styles.nextUpHead}>
                      <div className={styles.nextUpText}>
                        <span className={styles.nextUpTitle}>{nextUp.title}</span>
                        <span className={styles.nextUpMeta}>
                          {nextUp.divisionName} · {nextUp.location}
                        </span>
                      </div>
                      <Badge variant={registrationStatus(nextUp).variant}>
                        {registrationStatus(nextUp).label}
                      </Badge>
                    </div>
                    <div className={styles.hairline} />
                    <div className={styles.nextUpFoot}>
                      <DateChip>{formatEventDates(nextUp.startDate, nextUp.endDate)}</DateChip>
                      <Link href={`/tournament/${nextUp.slug}`} className={styles.cardAction}>
                        View bracket
                      </Link>
                    </div>
                  </div>
                )}
              </Card>

              <Card radius="xl" padding={24}>
                <div className={styles.cardHeadTight} style={{ marginBottom: 20 }}>
                  <h2 className={styles.cardTitle}>Performance</h2>
                  <span className={styles.cardNote}>Sample data</span>
                </div>
                <div className={styles.perfList}>
                  <div className={styles.perfRow}>
                    <span className={styles.perfLabel}>Sets won</span>
                    <div className={styles.perfTrack}>
                      <div className={styles.perfFill} style={{ width: '65%' }} />
                    </div>
                    <span className={styles.perfVal}>41</span>
                  </div>
                  <div className={styles.perfRow}>
                    <span className={styles.perfLabel}>Sets lost</span>
                    <div className={styles.perfTrack}>
                      <div className={styles.perfFillMuted} style={{ width: '35%' }} />
                    </div>
                    <span className={styles.perfVal}>22</span>
                  </div>
                  <div className={styles.hairline} />
                  <div className={styles.perfFact}>
                    <span className={styles.perfFactLabel}>Best finish</span>
                    <span className={styles.perfFactValue}>Winner · Khao Lak Open 2026</span>
                  </div>
                  <div className={styles.perfFact}>
                    <span className={styles.perfFactLabel}>Longest streak</span>
                    <span className={styles.perfFactValue}>5 matches</span>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* ── My events — every team this account has registered ──── */}
        {tab === 'events' && (
          <Card radius="xl" padding={24}>
            <h2 className={styles.cardTitleSpaced}>My Events</h2>

            {regsLoading && (
              <>
                <div className={styles.skeleton} />
                <div className={styles.skeleton} />
              </>
            )}

            {!regsLoading && regsError && (
              <div className={styles.errorState}>{regsError}</div>
            )}

            {!regsLoading && !regsError && registrations.length === 0 && (
              <div className={styles.emptyState}>
                <Icon name="calendar" size={28} color="var(--text-muted)" />
                <span>You haven&apos;t registered for a tournament yet</span>
                <Link href="/" className={styles.emptyLink}>Browse events</Link>
              </div>
            )}

            {/* Two groups rather than one long list: what is coming is the
                thing a player opens this page to check. */}
            {!regsLoading && !regsError && registrations.length > 0 &&
              [
                { heading: 'Upcoming', rows: upcoming },
                { heading: 'Past events', rows: past },
              ]
                .filter(group => group.rows.length > 0)
                .map(group => (
                  <div key={group.heading} className={styles.eventGroup}>
                    <h3 className={styles.eventGroupTitle}>{group.heading}</h3>
                    {group.rows.map(reg => {
                      const status = registrationStatus(reg);
                      return (
                        <Link
                          key={reg.teamId}
                          href={`/tournament/${reg.slug}`}
                          className={styles.eventRow}
                        >
                          <div className={styles.eventText}>
                            <span className={styles.eventName}>{reg.title}</span>
                            <span className={styles.eventMeta}>
                              {reg.divisionName} · {reg.location}
                            </span>
                          </div>
                          <span className={styles.eventDates}>
                            {formatEventDates(reg.startDate, reg.endDate)}
                          </span>
                          <span className={styles.eventTeam}>{reg.teamName}</span>
                          <div className={styles.eventBadge}>
                            <Badge variant={status.variant}>{status.label}</Badge>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                ))}
          </Card>
        )}

        {/* ── Starred — sample, pending a starred-events table ─────── */}
        {tab === 'starred' && (
          <div className={styles.starredGrid}>
            {SAMPLE_STARRED.map(s => (
              <Card key={s.id} radius="xl" padding={22}>
                <div className={styles.starredInner}>
                  <div className={styles.starredHead}>
                    <Badge variant={s.badgeVariant}>{s.status}</Badge>
                    <Icon name="starFilled" size={20} color="var(--color-primary)" />
                  </div>
                  <div className={styles.starredText}>
                    <span className={styles.starredTitle}>{s.name}</span>
                    <span className={styles.starredPlace}>{s.place}</span>
                  </div>
                  <div className={styles.hairline} />
                  <div className={styles.starredFoot}>
                    <span className={styles.starredDates}>{s.dates}</span>
                    <span className={styles.starredAction}>{s.action}</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
