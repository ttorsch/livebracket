'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { Camera, Shield, MapPin, Copy, Check, Bell, MessageSquare, Settings, LogOut, Pencil } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  DateChip,
  Icon,
  Logo,
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

/* ── Types ────────────────────────────────────────────────────────── */

export interface PartnerStat {
  name: string;
  avatarUrl: string | null;
  meta: string;
  record: string;
  pct: string;
}

export interface PlayerStats {
  matchesCount: number;
  wins: number;
  losses: number;
  winRate: number;
  setsWon: number;
  setsLost: number;
  bestFinish: string | null;
  longestStreak: number;
  partners: PartnerStat[];
}

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
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* The stored id from the profiles row, not one derived from the auth
   * uuid: a hash cannot be searched (it is one-way, so a lookup would
   * mean hashing every account) and is not unique. This is the number
   * /api/players/lookup actually resolves, so the one shown here is the
   * one a teammate can use. */
  const playerId = session.playerId;

  const handleCopyPlayerId = async () => {
    if (!playerId) return;
    try {
      await navigator.clipboard.writeText(playerId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy player ID:', err);
    }
  };

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

  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [regRes, statsRes] = await Promise.all([
          fetch('/api/me/registrations', { cache: 'no-store' }),
          fetch('/api/me/stats', { cache: 'no-store' }),
        ]);

        if (regRes.ok) {
          const regData = await regRes.json();
          if (!cancelled) setRegistrations(regData.registrations ?? []);
        } else {
          if (!cancelled) setRegsError('Could not load your events');
        }

        if (statsRes.ok) {
          const statsData = await statsRes.json();
          if (!cancelled) setStats(statsData.stats ?? null);
        }
      } catch (err) {
        if (!cancelled) setRegsError(err instanceof Error ? err.message : 'Could not load your events');
      } finally {
        if (!cancelled) {
          setRegsLoading(false);
          setStatsLoading(false);
        }
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
            className={styles.topbarIconButton}
            title="Notifications"
            aria-label="Notifications"
            onClick={() => {}}
          >
            <Bell size={21} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className={styles.topbarIconButton}
            title="Chat"
            aria-label="Chat"
            onClick={() => {}}
          >
            <MessageSquare size={21} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className={styles.topbarIconButton}
            title="Settings"
            aria-label="Settings"
            onClick={() => {}}
          >
            <Settings size={21} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className={styles.topbarIconButton}
            title="Log Out"
            aria-label="Log Out"
            onClick={handleLogout}
          >
            <LogOut size={21} strokeWidth={1.8} />
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
                <button
                  type="button"
                  className={styles.editProfileIconButton}
                  onClick={() => setIsEditing(true)}
                  title="Edit Profile"
                  aria-label="Edit Profile"
                >
                  <Pencil size={16} strokeWidth={1.8} />
                </button>
              </div>
              <div className={styles.metaRow}>
                {session.club && (
                  <span className={styles.metaItem}>
                    <Shield size={16} color="var(--color-primary)" />
                    {session.club}
                  </span>
                )}
                {session.hometown && (
                  <span className={styles.metaItem}>
                    <MapPin size={16} color="var(--color-primary)" />
                    {session.hometown}
                  </span>
                )}
              </div>
              <div className={styles.playerIdRow}>
                <span className={styles.playerIdLabel}>Player ID:</span>
                <span className={styles.playerIdValue}>{playerId}</span>
                <button
                  type="button"
                  onClick={handleCopyPlayerId}
                  className={styles.copyBtn}
                  title={copied ? 'Copied!' : 'Copy Player ID'}
                  aria-label="Copy Player ID"
                >
                  {copied ? <Check size={14} color="#16a34a" /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className={styles.identityRight}>
          <div className={styles.statRow}>
            <div className={styles.stat}>
              <span className={styles.statNum}>{regsLoading ? '–' : tournamentCount}</span>
              <span className={styles.statLabel}>Tournaments</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.stat}>
              <span className={styles.statNum}>{statsLoading ? '–' : (stats?.wins ?? 0)}</span>
              <span className={styles.statLabel}>Wins</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.stat}>
              <span className={styles.statNum}>
                {statsLoading ? '–' : (stats && stats.matchesCount > 0 ? `${stats.winRate}%` : '0%')}
              </span>
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
          fullWidth
        />
      </div>

      {/* ── Content ───────────────────────────────────────────────── */}
      <div className={`${styles.shell} ${styles.content}`}>

        {/* ── Overview ────────────────────────────────────────────── */}
        {tab === 'overview' && (
          <div className={styles.overviewGrid}>
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
                <div className={styles.cardHeadTight}>
                  <h2 className={styles.cardTitle}>Partners</h2>
                </div>
                {statsLoading && <div className={styles.skeleton} />}
                {!statsLoading && (!stats || stats.partners.length === 0) && (
                  <div className={styles.emptyState} style={{ padding: '24px 0' }}>
                    <Icon name="users" size={24} color="var(--text-muted)" />
                    <span>No partner match history yet</span>
                  </div>
                )}
                {!statsLoading && stats && stats.partners.length > 0 &&
                  stats.partners.map(p => (
                    <div key={p.name} className={styles.partnerRow}>
                      <Avatar name={p.name} src={p.avatarUrl ?? undefined} size={36} />
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
                <div className={styles.cardHeadTight} style={{ marginBottom: 20 }}>
                  <h2 className={styles.cardTitle}>Performance</h2>
                </div>
                {statsLoading && <div className={styles.skeleton} />}
                {!statsLoading && (
                  <div className={styles.perfList}>
                    {(() => {
                      const setsWon = stats?.setsWon ?? 0;
                      const setsLost = stats?.setsLost ?? 0;
                      const totalSets = setsWon + setsLost;
                      const wonPct = totalSets > 0 ? Math.round((setsWon / totalSets) * 100) : 0;
                      const lostPct = totalSets > 0 ? 100 - wonPct : 0;

                      return (
                        <>
                          <div className={styles.perfRow}>
                            <span className={styles.perfLabel}>Sets won</span>
                            <div className={styles.perfTrack}>
                              <div className={styles.perfFill} style={{ width: `${wonPct}%` }} />
                            </div>
                            <span className={styles.perfVal}>{setsWon}</span>
                          </div>
                          <div className={styles.perfRow}>
                            <span className={styles.perfLabel}>Sets lost</span>
                            <div className={styles.perfTrack}>
                              <div className={styles.perfFillMuted} style={{ width: `${lostPct}%` }} />
                            </div>
                            <span className={styles.perfVal}>{setsLost}</span>
                          </div>
                        </>
                      );
                    })()}
                    <div className={styles.hairline} />
                    <div className={styles.perfFact}>
                      <span className={styles.perfFactLabel}>Best finish</span>
                      <span className={styles.perfFactValue}>{stats?.bestFinish || '—'}</span>
                    </div>
                    <div className={styles.perfFact}>
                      <span className={styles.perfFactLabel}>Longest streak</span>
                      <span className={styles.perfFactValue}>
                        {stats?.longestStreak
                          ? `${stats.longestStreak} match${stats.longestStreak === 1 ? '' : 'es'}`
                          : '—'}
                      </span>
                    </div>
                  </div>
                )}
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

        {/* ── Starred ─────────────────────────────────────────────── */}
        {tab === 'starred' && (
          <Card radius="xl" padding={32}>
            <div className={styles.emptyState}>
              <Icon name="star" size={28} color="var(--text-muted)" />
              <span>No starred tournaments yet</span>
              <Link href="/" className={styles.emptyLink}>Browse events to star</Link>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
