'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, QrCode, Trophy, ArrowRight, Settings, Calendar, MapPin } from 'lucide-react';
import styles from './page.module.css';
import CreateTournamentModal from './CreateTournamentModal';
import { getDashboardTournaments, todayLocal, type DashboardTournament } from '../../lib/data';

interface Organizer {
  name: string;
  club: string | null;
  avatar_url: string | null;
}

const TODAY = todayLocal();

/* Map tournament phase → filter status */
const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
  { key: 'announced', label: 'Announced' },
  { key: 'draft', label: 'Draft' },
] as const;

type StatusKey = (typeof STATUS_FILTERS)[number]['key'];

function phaseToStatus(phase: number): 'coming-up' | 'announced' | 'draft' {
  switch (phase) {
    case 3: return 'coming-up';
    case 4: return 'coming-up';
    case 2: return 'announced';
    default: return 'draft';
  }
}

type CardTournament = DashboardTournament;

// Registration is open while live (phase 3); closed the day before (phase 4).
function matchesFilter(t: CardTournament, key: StatusKey): boolean {
  if (key === 'all') return true;
  if (key === 'open') return t.phase === 3;
  if (key === 'closed') return t.phase === 4;
  return phaseToStatus(t.phase) === key;
}

export default function OrganizerDashboard() {
  const [tournaments, setTournaments] = useState<DashboardTournament[]>([]);
  const [organizer, setOrganizer] = useState<Organizer | null>(null);
  const [qrOpen, setQrOpen] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusKey>('all');
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    getDashboardTournaments().then(setTournaments).catch(console.error);
    fetch('/api/organizer').then(r => r.json()).then(setOrganizer).catch(console.error);
  }, []);

  const visibleTournaments = tournaments.filter(t => matchesFilter(t, statusFilter));
  const liveTournaments = tournaments.filter(t => t.startDate === TODAY);

  const copyLink = (id: string, url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  return (
    <div className={styles.page}>
      {/* ── Sidebar ──────────────────────────────────────────── */}
      <aside className={styles.sidebar}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandMark}>
            <svg viewBox="296 73 687 687" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="639.5" cy="416.5" r="343.5" fill="#EB6F43" />
  <rect x="428" y="234" width="165.327" height="35.9406" rx="15" fill="white" />
  <rect x="428" y="561.059" width="165.327" height="35.9406" rx="15" fill="white" />
  <rect x="593.327" y="308.277" width="165.327" height="35.9406" rx="15" fill="white" />
  <rect x="722.713" y="462.822" width="129.386" height="35.9406" rx="15" fill="white" />
  <rect x="593.327" y="489.178" width="129.386" height="35.9406" rx="15" fill="white" />
  <rect x="557.386" y="416.099" width="182.099" height="35.9406" rx="15" transform="rotate(-90 557.386 416.099)" fill="white" />
  <rect x="722.713" y="498.762" width="190.485" height="35.9406" rx="15.5" transform="rotate(-90 722.713 498.762)" fill="white" />
  <rect x="557.386" y="597" width="180.901" height="35.9406" rx="15" transform="rotate(-90 557.386 597)" fill="white" />
</svg>
          </span>
          <span className={styles.brandName}>Live Bracket</span>
        </Link>

        <nav className={styles.sideNav}>
          <Link href="/dashboard" className={`${styles.sideLink} ${styles.sideLinkActive}`}>
            <span className={styles.sideIcon}><Trophy size={18} /></span>
            <span>My Tournament</span>
          </Link>
        </nav>

        <Link href="/profile" className={styles.sideProfile}>
          <span className={styles.sideAvatar}>
            {organizer?.avatar_url ? (
              <img src={organizer.avatar_url} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
            ) : '🏐'}
          </span>
          <div>
            <p className={styles.sideProfileName}>{organizer?.name ?? '—'}</p>
            <p className={styles.sideProfileClub}>{organizer?.club ?? ''}</p>
          </div>
        </Link>
      </aside>

      {/* ── Main area ─────────────────────────────────────────── */}
      <main className={styles.main}>
        {/* Header */}
        <div className={styles.header}>
          <div>
            <p className={styles.headerEyebrow}>Organizer dashboard</p>
            <h1 className={styles.headerTitle}>Welcome back{organizer ? `, ${organizer.name.split(' ')[0]}` : ''}</h1>
          </div>
          <button type="button" className={styles.newTournamentBtn} onClick={() => setCreateOpen(true)}>
            <Plus size={18} />
            New tournament
          </button>
        </div>

        {/* Live now — tournaments starting today (hidden when none) */}
        {liveTournaments.length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>
                Live Now
              </h2>
            </div>
            <div className={styles.tournamentList}>
              {liveTournaments.map(t => (
                <TournamentCard
                  key={t.id}
                  t={t}
                  qrOpen={qrOpen}
                  setQrOpen={setQrOpen}
                  copiedId={copiedId}
                  copyLink={copyLink}
                />
              ))}
            </div>
          </section>
        )}

        {/* Active tournaments */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Tournaments</h2>
          </div>

          <div className={styles.filterTabs}>
            {STATUS_FILTERS.map(f => {
              const count = tournaments.filter(t => matchesFilter(t, f.key)).length;
              return (
                <button
                  key={f.key}
                  type="button"
                  className={`${styles.filterTab} ${statusFilter === f.key ? styles.filterTabActive : ''}`}
                  onClick={() => setStatusFilter(f.key)}
                >
                  {f.label}
                  <span className={styles.filterCount}>{count}</span>
                </button>
              );
            })}
          </div>

          <div className={styles.tournamentList}>
            {visibleTournaments.length === 0 && (
              <p className={styles.filterEmpty}>No tournaments in this category.</p>
            )}
            {visibleTournaments.map(t => (
              <TournamentCard
                key={t.id}
                t={t}
                qrOpen={qrOpen}
                setQrOpen={setQrOpen}
                copiedId={copiedId}
                copyLink={copyLink}
              />
            ))}
          </div>
        </section>
      </main>

      <CreateTournamentModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function TournamentCard({
  t,
  qrOpen,
  setQrOpen,
  copiedId,
  copyLink,
}: {
  t: CardTournament;
  qrOpen: string | null;
  setQrOpen: (v: string | null) => void;
  copiedId: string | null;
  copyLink: (id: string, url: string) => void;
}) {
  return (
    <div className={styles.tournamentCard}
      style={{ backdropFilter: 'blur(16px) saturate(180%)', WebkitBackdropFilter: 'blur(16px) saturate(180%)' }}
    >
      <div className={styles.tournamentCardBg} aria-hidden="true">
        {t.imageUrl && <img src={t.imageUrl} alt="" />}
      </div>

      <span
        className={styles.tournamentCardGlass}
        aria-hidden="true"
        style={{
          backdropFilter: 'blur(15px) saturate(180%)',
          WebkitBackdropFilter: 'blur(15px) saturate(180%)',
        }}
      />

      <div className={styles.tournamentCardImage}>
        {!t.imageUrl && <Trophy size={36} strokeWidth={1.5} />}
      </div>

      <div className={styles.tournamentCardBody}>
      <div className={styles.tournamentCardTop}>
        <div>
          <p className={styles.tournamentCardEyebrow}>
            <Calendar size={14} /> {t.date}
          </p>
          <h3 className={styles.tournamentCardTitle}>{t.title}</h3>
          <div className={styles.tournamentMeta}>
            <span className={styles.tournamentMetaItem}>
              <MapPin size={14} /> {t.location}
            </span>
          </div>
        </div>
        <div className={styles.tournamentCardActions}>
          <button
            className={styles.iconBtn}
            title="Generate scorekeeper QR"
            onClick={() => setQrOpen(qrOpen === t.id ? null : t.id)}
          >
            <QrCode size={18} />
          </button>
          <Link href={`/tournament/${t.id}`} className={styles.iconBtn} title="View tournament">
            <ArrowRight size={18} />
          </Link>
        </div>
      </div>

      <div className={styles.divAvail}>
        <div className={styles.divAvailHeader}>
          <span className={styles.divAvailHeading}>Divisions</span>
          <span className={styles.divAvailHint}>spots filled</span>
        </div>
        {t.divisions.length > 0 ? (
          <div className={styles.divCircleGrid}>
            {t.divisions.map(d => {
              const pct = d.cap > 0 ? Math.min(100, (d.filled / d.cap) * 100) : 0;
              const full = d.filled >= d.cap;
              const R = 22;
              const C = 2 * Math.PI * R;
              return (
                <div key={d.name} className={styles.divCircleItem}>
                  <svg className={styles.divCircle} viewBox="0 0 52 52" width="56" height="56">
                    <circle className={styles.divCircleTrack} cx="26" cy="26" r={R} fill="none" />
                    <circle
                      className={`${styles.divCircleFill} ${full ? styles.divCircleFillFull : ''}`}
                      cx="26"
                      cy="26"
                      r={R}
                      fill="none"
                      strokeDasharray={C}
                      strokeDashoffset={C * (1 - pct / 100)}
                      transform="rotate(-90 26 26)"
                    />
                    <text
                      className={styles.divCircleText}
                      x="26"
                      y="26"
                      textAnchor="middle"
                      dominantBaseline="central"
                    >
                      {d.filled}/{d.cap}
                    </text>
                  </svg>
                  <span className={styles.divCircleName}>{d.name}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <span className={styles.divBadgeEmpty}>No divisions added yet</span>
        )}
      </div>

      {qrOpen === t.id && (
        <div className={styles.qrPanel}>
          <div className={styles.qrPanelHeader}>
            <span>Scorekeeper QR code</span>
            <button className={styles.qrClose} onClick={() => setQrOpen(null)}>×</button>
          </div>
          <div className={styles.qrCode}>
            {/* Placeholder QR visual */}
            <div className={styles.qrPlaceholder}>
              <QrCode size={80} color="rgba(20,24,30,0.5)" />
              <p>Scan to open court scoring</p>
            </div>
          </div>
          <div className={styles.qrLink}>
            <span className={styles.qrUrl}>livebracket.klv.app/score/{t.id}</span>
            <button
              className={styles.copyBtn}
              onClick={() => copyLink(t.id, `https://livebracket.klv.app/score/${t.id}`)}
            >
              {copiedId === t.id ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      <div className={styles.tournamentCardFooter}>
        <Link href={`/tournament/${t.id}`} className={styles.seeResultBtn}>
          <Trophy size={16} /> See Bracket
        </Link>
        <Link href={`/dashboard/tournament/${t.id}/setup`} className={styles.setupWorkspaceBtn}>
          <Settings size={16} /> Setup Tournament
        </Link>
      </div>
      </div>
    </div>
  );
}
