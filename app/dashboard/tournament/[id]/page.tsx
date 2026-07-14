'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Calendar, ChevronDown, MapPin, Trophy, Users, X } from 'lucide-react';
import styles from './page.module.css';
import { Button } from '../../../../components/livebracket-ds';
import { getTournamentDetail, type TournamentDetail, type DetailDivision } from '../../../../lib/data';

const FALLBACK_HERO = '/images/livebracket/beach-volleyball.jpg';

interface SeedTeam {
  id: string;
  name: string;
}

interface DrawSettings {
  pools: number;
  advance: number;
  crossing: string;
}

const DEFAULT_DRAW: DrawSettings = { pools: 4, advance: 2, crossing: 'fivb' };

/* ── Bracket view model ───────────────────────────────────────
   One shape whether the rounds come from the database (generated
   draw) or from the client-side projection used before a draw
   exists. */

interface ViewRow {
  seed: number | null;
  name: string;
  win: boolean;
  live: boolean;
}

interface ViewMatch {
  live: boolean;
  hasRight: boolean;
  hasLeft: boolean;
  hasSpine: boolean;
  rowA: ViewRow;
  rowB: ViewRow;
}

interface ViewRound {
  name: string;
  matches: ViewMatch[];
}

interface BracketView {
  rounds: ViewRound[];
  champion: string | null; // null = undecided
  fromDb: boolean;
}

/* Standard bracket seed placement for a field of `size` (power of 2). */
function seedPlacement(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next: number[] = [];
    const m = order.length * 2;
    for (const s of order) next.push(s, m + 1 - s);
    order = next;
  }
  return order;
}

const POOL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/* Mirrors the server's serpentine `assignPools`: seed-ordered teams are
   dealt into `poolsCount` pools, reversing direction every row so pool
   strength stays balanced. Named pools reproduce what was actually saved. */
function assignPools<T>(items: T[], poolsCount: number): { name: string; items: T[] }[] {
  const out: T[][] = Array.from({ length: poolsCount }, () => []);
  items.forEach((item, i) => {
    const row = Math.floor(i / poolsCount);
    const col = i % poolsCount;
    out[row % 2 === 0 ? col : poolsCount - 1 - col].push(item);
  });
  return out
    .map((teams, i) => ({ name: POOL_LETTERS[i] ?? String(i + 1), items: teams }))
    .filter(p => p.items.length > 0);
}

function roundName(fieldSize: number): string {
  if (fieldSize === 2) return 'Final';
  if (fieldSize === 4) return 'Semifinals';
  if (fieldSize === 8) return 'Quarterfinals';
  return `Round of ${fieldSize}`;
}

/* Projection: favorite (lower seed) advances everywhere; used until a
   real draw has been generated for the division. */
function projectBracket(teams: SeedTeam[]): BracketView | null {
  if (teams.length < 2) return null;
  let size = 2;
  while (size < teams.length) size *= 2;

  interface Entrant { seed: number; name: string | null }
  let field: Entrant[] = seedPlacement(size).map(seed => ({ seed, name: teams[seed - 1]?.name ?? null }));

  const totalRounds = Math.log2(size);
  const rounds: ViewRound[] = [];

  for (let r = 0; r < totalRounds; r++) {
    const isFinal = r === totalRounds - 1;
    const matches: ViewMatch[] = [];
    const winners: Entrant[] = [];

    for (let i = 0; i < field.length / 2; i++) {
      const a = field[2 * i];
      const b = field[2 * i + 1];
      const aWins = b.name === null || (a.name !== null && a.seed < b.seed);
      winners.push(aWins ? a : b);

      const mkRow = (e: Entrant, win: boolean): ViewRow => ({
        seed: e.name === null ? null : e.seed,
        name: e.name ?? 'BYE',
        win,
        live: isFinal,
      });

      matches.push({
        live: isFinal,
        hasRight: !isFinal,
        hasLeft: r > 0,
        hasSpine: !isFinal && i % 2 === 0,
        rowA: mkRow(a, !isFinal && aWins),
        rowB: mkRow(b, !isFinal && !aWins),
      });
    }

    rounds.push({ name: roundName(field.length), matches });
    field = winners;
  }

  return { rounds, champion: teams[0]?.name ?? null, fromDb: false };
}

/* Real bracket: the division's single-elimination rounds from the DB. */
function dbBracket(division: DetailDivision): BracketView | null {
  const knockout = division.bracket.filter(r => (r.format === 'single' || r.format === 'double') && r.matches.length > 0);
  if (knockout.length === 0) return null;

  const seedOf = new Map(division.teamsList.map(t => [t.id, t.seed]));
  const total = knockout.length;

  const rounds: ViewRound[] = knockout.map((r, ri) => ({
    name: r.round,
    matches: r.matches.map((m, mi) => {
      const bye = ri === 0 && m.status === 'done' && (m.teamAId === null) !== (m.teamBId === null);
      const mkRow = (id: string | null, name: string | null, winnerSide: boolean): ViewRow => ({
        seed: id ? seedOf.get(id) ?? null : null,
        name: name ?? (bye ? 'BYE' : 'TBD'),
        win: winnerSide,
        live: m.status === 'live',
      });
      return {
        live: m.status === 'live',
        hasRight: ri < total - 1,
        hasLeft: ri > 0,
        hasSpine: ri < total - 1 && mi % 2 === 0,
        rowA: mkRow(m.teamAId, m.teamAName, m.winner === 'A'),
        rowB: mkRow(m.teamBId, m.teamBName, m.winner === 'B'),
      };
    }),
  }));

  const final = knockout[total - 1].matches[0];
  const champion = final?.winner === 'A' ? final.teamAName : final?.winner === 'B' ? final.teamBName : null;

  return { rounds, champion, fromDb: true };
}

export default function OrganizerBracketPage() {
  const params = useParams<{ id: string }>();
  const slug = params.id;

  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [activeDiv, setActiveDiv] = useState<string>('');
  const [teamsOpen, setTeamsOpen] = useState(true);
  const [seedsByDiv, setSeedsByDiv] = useState<Record<string, SeedTeam[]>>({});
  const [configByDiv, setConfigByDiv] = useState<Record<string, DrawSettings>>({});
  const [pendingSeed, setPendingSeed] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  useEffect(() => {
    setSearchQuery('');
    setDropdownOpen(false);
  }, [activeDiv]);

  const [backHidden, setBackHidden] = useState(false);
  const lastScrollY = useRef(0);

  const load = useCallback(async (preferDiv?: string) => {
    const data = await getTournamentDetail(slug);
    setDetail(data);
    if (data) {
      const config: Record<string, DrawSettings> = {};
      data.divisions.forEach(d => {
        config[d.id] = d.drawConfig
          ? { pools: d.drawConfig.pools, advance: d.drawConfig.advance, crossing: d.drawConfig.crossing }
          : { ...DEFAULT_DRAW };
      });
      // Keep whatever top seeds were already picked for a division across a
      // reload (e.g. right after Draw Pool) instead of clearing them; only
      // drop references to teams that are no longer confirmed.
      setSeedsByDiv(prev => {
        const next: Record<string, SeedTeam[]> = {};
        data.divisions.forEach(d => {
          const confirmedIds = new Set(d.teamsList.filter(t => t.status !== 'waitlist').map(t => t.id));
          next[d.id] = (prev[d.id] ?? []).filter(s => confirmedIds.has(s.id));
        });
        return next;
      });
      setConfigByDiv(config);
      setActiveDiv(prev => (preferDiv && data.divisions.some(d => d.id === preferDiv) ? preferDiv : prev && data.divisions.some(d => d.id === prev) ? prev : data.divisions[0]?.id ?? ''));
    }
    return data;
  }, [slug]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setBackHidden(y > 80 && y > lastScrollY.current);
      lastScrollY.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const division = detail?.divisions.find(d => d.id === activeDiv) ?? null;
  const seeds = seedsByDiv[activeDiv] ?? [];
  const config = configByDiv[activeDiv] ?? DEFAULT_DRAW;

  const confirmedTeams = useMemo(() => {
    return division?.teamsList.filter(t => t.status !== 'waitlist') ?? [];
  }, [division]);

  const unseededTeams = useMemo(() => {
    return confirmedTeams.filter(ct => !seeds.some(s => s.id === ct.id));
  }, [confirmedTeams, seeds]);

  const filteredTeams = useMemo(() => {
    return unseededTeams.filter(t => t.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [unseededTeams, searchQuery]);

  const waitlistTeams = useMemo(() => {
    return division?.teamsList.filter(t => t.status === 'waitlist') ?? [];
  }, [division]);

  const bracket = useMemo<BracketView | null>(() => {
    if (!division) return null;
    return dbBracket(division) ?? projectBracket(seeds);
  }, [division, seeds]);

  const poolGroups = useMemo(() => {
    if (!division?.drawConfig) return [];
    const poolRound = division.bracket.find(r => r.format === 'pool');
    if (!poolRound || poolRound.matches.length === 0) return [];
    return assignPools(confirmedTeams, division.drawConfig.pools).map(pool => {
      const ids = new Set(pool.items.map(t => t.id));
      const matches = poolRound.matches.filter(m => m.teamAId && m.teamBId && ids.has(m.teamAId) && ids.has(m.teamBId));
      return { name: pool.name, teams: pool.items, matches };
    });
  }, [division, confirmedTeams]);

  if (loading) {
    return <div className={styles.page}><div className={styles.centerState}>Loading tournament…</div></div>;
  }
  if (!detail) {
    return (
      <div className={styles.page}>
        <div className={styles.centerState}>
          Tournament not found.
          <Link href="/dashboard">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  const totalTeams = detail.divisions.reduce((sum, d) => sum + d.filled, 0);
  const isLive = detail.date === 'Today';
  const heroImage = FALLBACK_HERO;

  const setConfig = (patch: Partial<DrawSettings>) => {
    setConfigByDiv({ ...configByDiv, [activeDiv]: { ...config, ...patch } });
  };

  const addSeed = (id: string) => {
    const team = confirmedTeams.find(t => t.id === id);
    if (!team) return;
    setSeedsByDiv({
      ...seedsByDiv,
      [activeDiv]: [...seeds, { id: team.id, name: team.name }]
    });
    setPendingSeed(null);
  };

  const removeSeed = (id: string) => {
    setSeedsByDiv({
      ...seedsByDiv,
      [activeDiv]: seeds.filter(t => t.id !== id)
    });
  };

  const reorder = (i: number) => {
    if (dragIndex === null || dragIndex === i) return;
    const list = [...seeds];
    const [m] = list.splice(dragIndex, 1);
    list.splice(i, 0, m);
    setSeedsByDiv({ ...seedsByDiv, [activeDiv]: list });
    setDragIndex(i);
  };

  const saveDraw = async () => {
    const totalConfirmed = seeds.length + unseededTeams.length;
    if (!division || totalConfirmed < 2 || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const shuffledUnseeded = [...unseededTeams]
        .map(value => ({ value, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value);

      const fullSeedOrder = [
        ...seeds.map(t => t.id),
        ...shuffledUnseeded.map(t => t.id)
      ];

      const res = await fetch(`/api/tournaments/${slug}/divisions/${division.id}/draw`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seedOrder: fullSeedOrder,
          pools: config.pools,
          advance: config.advance,
          crossing: config.crossing,
          generate: true,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      await load(division.id);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save the draw');
    } finally {
      setSaving(false);
    }
  };

  const perPool = Math.max(1, Math.round(confirmedTeams.length / config.pools) || 1);
  const firstRoundMatches = bracket?.rounds[0]?.matches.length ?? 0;
  const colHeight = Math.max(firstRoundMatches * 95, 190);

  const rowClass = (row: ViewRow) =>
    `${styles.matchName} ${row.win ? styles.matchNameWin : ''} ${row.live ? styles.matchNameLive : ''}`;

  return (
    <div className={styles.page}>
      <Link
        href="/dashboard"
        className={`${styles.backLink} ${backHidden ? styles.backLinkHidden : ''}`}
        aria-label="Back to Dashboard"
      >
        <ArrowLeft size={18} />
      </Link>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section
        className={styles.hero}
        style={{
          backgroundImage: `linear-gradient(180deg, rgba(20,24,30,0.12) 0%, rgba(20,24,30,0.30) 45%, rgba(20,24,30,0.62) 100%), url('${heroImage}')`,
        }}
      >
        <div className={styles.heroInner}>
          <div className={styles.heroContent}>
            {isLive && (
              <div className={styles.heroTopRow}>
                <span className={styles.livePill}>
                  <span className={styles.livePillDot} aria-hidden="true" />
                  Live Now
                </span>
              </div>
            )}
            <h1 className={styles.heroTitle}>{detail.title}</h1>
            <div className={styles.heroMeta}>
              <span className={styles.heroMetaPill}><Calendar size={15} /> {detail.date}</span>
              <span className={styles.heroMetaPill}><MapPin size={15} /> {detail.location}</span>
              <span className={styles.heroMetaPill}>
                <Users size={15} /> {detail.divisions.length} Division{detail.divisions.length === 1 ? '' : 's'} · {totalTeams} Teams
              </span>
            </div>
            {detail.description && <p className={styles.heroDesc}>{detail.description}</p>}
          </div>
        </div>
      </section>

      {/* ── Sticky division bar ──────────────────────────────── */}
      <div className={styles.stickyBar}>
        <div className={styles.stickyInner}>
          <div className={styles.divisionsGroup}>
            <span className={styles.divisionsLabel}>
              <Trophy size={20} />
              <span>Divisions</span>
            </span>
            <div className={styles.segmented}>
              {detail.divisions.map(d => (
                <button
                  key={d.id}
                  type="button"
                  className={`${styles.segBtn} ${d.id === activeDiv ? styles.segBtnActive : ''}`}
                  onClick={() => { setActiveDiv(d.id); setPendingSeed(null); setSaveError(null); }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          {division && (
            <span className={styles.teamsCountPill}>
              <Users size={16} /> {division.filled} Teams · {division.label}
            </span>
          )}
        </div>
      </div>

      <main className={styles.main}>
        {/* ── Registered teams ───────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHead} onClick={() => setTeamsOpen(v => !v)}>
            <div>
              <h2 className={styles.sectionTitle}>Registered Teams <span style={{ color: 'var(--ink-500)' }}>({confirmedTeams.length})</span></h2>
            </div>
            <button type="button" className={styles.toggleBtn} aria-label="Toggle teams">
              <span>{teamsOpen ? 'Hide' : 'Show'}</span>
              <span className={`${styles.chevron} ${teamsOpen ? styles.chevronOpen : ''}`}>
                <ChevronDown size={18} />
              </span>
            </button>
          </div>
          <div className={`${styles.teamsWrap} ${teamsOpen ? styles.teamsWrapOpen : styles.teamsWrapClosed}`}>
            {confirmedTeams.length > 0 ? (
              <div className={styles.teamsGrid}>
                {confirmedTeams.map(team => (
                  <div key={team.id} className={styles.teamCard}>
                    <span className={styles.teamName}>{team.name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptyNote}>No teams registered in this division yet.</div>
            )}
          </div>
        </section>

        {/* ── Round 1: pool play ─────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Round 1 <span style={{ color: 'var(--ink-500)' }}>· Pool Play</span></h2>
          <div className={styles.poolRow}>
            <div className={styles.seedCard}>
              <h3 className={styles.cardTitle}>Top Seed</h3>
              <div className={styles.seedSelectRow}>
                <div className={styles.selectWrap} ref={dropdownRef}>
                  <input
                    type="text"
                    className={`${styles.select} ${styles.selectAccent}`}
                    style={{ cursor: 'text' }}
                    placeholder={unseededTeams.length === 0 ? "All teams seeded" : "Select team..."}
                    value={dropdownOpen ? searchQuery : (confirmedTeams.find(t => t.id === pendingSeed)?.name ?? searchQuery)}
                    onChange={e => {
                      setSearchQuery(e.target.value);
                      setDropdownOpen(true);
                    }}
                    onFocus={() => {
                      setSearchQuery('');
                      setDropdownOpen(true);
                    }}
                    disabled={unseededTeams.length === 0}
                  />
                  <button
                    type="button"
                    className={styles.selectChevron}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    onClick={() => {
                      if (unseededTeams.length > 0) {
                        setDropdownOpen(!dropdownOpen);
                      }
                    }}
                    disabled={unseededTeams.length === 0}
                    aria-label="Toggle dropdown"
                  >
                    <ChevronDown size={18} />
                  </button>

                  {/* Dropdown list popover */}
                  {dropdownOpen && unseededTeams.length > 0 && (
                    <div className={styles.dropdownPopover}>
                      {filteredTeams.map(team => (
                        <div
                          key={team.id}
                          className={styles.dropdownOption}
                          onClick={() => {
                            setPendingSeed(team.id);
                            setSearchQuery('');
                            setDropdownOpen(false);
                          }}
                        >
                          {team.name}
                        </div>
                      ))}
                      {filteredTeams.length === 0 && (
                        <div className={styles.dropdownEmpty}>No teams match search</div>
                      )}
                    </div>
                  )}
                </div>
                <Button
                  variant="primary"
                  size="medium"
                  onClick={() => {
                    if (pendingSeed) {
                      addSeed(pendingSeed);
                      setSearchQuery('');
                      setDropdownOpen(false);
                    }
                  }}
                  disabled={unseededTeams.length === 0 || !pendingSeed}
                >
                  Add Top Seed
                </Button>
              </div>
              <div className={styles.seedList}>
                {seeds.map((team, i) => (
                  <div
                    key={team.id}
                    draggable
                    onDragStart={() => setDragIndex(i)}
                    onDragEnter={() => reorder(i)}
                    onDragOver={e => e.preventDefault()}
                    onDragEnd={() => setDragIndex(null)}
                    className={`${styles.seedRow} ${dragIndex === i ? styles.seedRowDragging : ''}`}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span className={styles.seedRowNum}>{i + 1}</span>
                      <span className={styles.seedRowName}>{team.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSeed(team.id)}
                      title="Remove from seeding"
                      style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
                {seeds.length === 0 && (
                  <div className={styles.emptyNote}>No teams seeded yet. Use the dropdown above to add seeds.</div>
                )}
              </div>
            </div>

            <div className={styles.configCard}>
              <h3 className={styles.cardTitle}>Draw Configuration</h3>
              <div>
                <label className={styles.fieldLabel}>Number of Pools</label>
                <div className={styles.fieldRow}>
                  <input
                    type="number"
                    min={2}
                    max={8}
                    value={config.pools}
                    onChange={e => {
                      let v = parseInt(e.target.value, 10);
                      if (isNaN(v)) v = 2;
                      setConfig({ pools: Math.max(2, Math.min(8, v)) });
                    }}
                    className={styles.numInput}
                  />
                  <span className={styles.fieldSummary}>
                    {confirmedTeams.length} teams · {config.pools} pools · ~{perPool} per pool
                  </span>
                </div>
              </div>
              <div>
                <label className={styles.fieldLabel}>Teams Advancing per Pool</label>
                <div className={styles.fieldRow}>
                  <input
                    type="number"
                    min={1}
                    max={4}
                    value={config.advance}
                    onChange={e => {
                      let v = parseInt(e.target.value, 10);
                      if (isNaN(v)) v = 1;
                      setConfig({ advance: Math.max(1, Math.min(4, v)) });
                    }}
                    className={styles.numInput}
                  />
                  <span className={styles.fieldSummary}>
                    {config.advance * config.pools} teams advance to the knockout round
                  </span>
                </div>
              </div>
              <div>
                <label className={styles.fieldLabel}>Bracket Crossing Logic <em>*</em></label>
                <div className={styles.selectWrap}>
                  <select
                    className={styles.select}
                    value={config.crossing}
                    onChange={e => setConfig({ crossing: e.target.value })}
                  >
                    <option value="fivb">FIVB Standard Draw</option>
                    <option value="static">Static Cross-Bracket A1–D4</option>
                  </select>
                  <span className={styles.selectChevron}><ChevronDown size={18} /></span>
                </div>
                <p className={styles.fieldNote}>Determines how pool finishers are seeded into the knockout round.</p>
              </div>
              <div className={styles.drawBtnWrap}>
                <Button
                  variant="primary"
                  size="medium"
                  fullWidth
                  loading={saving}
                  disabled={confirmedTeams.length < 2}
                  onClick={saveDraw}
                >
                  Draw Pool
                </Button>
                {saveError && <p className={styles.saveError}>{saveError}</p>}
              </div>
            </div>
          </div>

          {poolGroups.length > 0 && (
            <div className={styles.poolsWrap}>
              <div className={styles.poolsHead}>
                <h3 className={styles.cardTitle}>Pool Results</h3>
                {!!division?.drawConfig?.attempts && (
                  <span className={styles.attemptNote}>
                    {division.drawConfig.attempts} attempt{division.drawConfig.attempts === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <div className={styles.poolsGrid}>
                {poolGroups.map(pool => (
                  <div key={pool.name} className={styles.poolCard}>
                    <div className={styles.poolCardHeader}>
                      <span className={styles.poolBadge}>{pool.name}</span>
                      <span className={styles.poolCardCount}>{pool.teams.length} teams</span>
                    </div>
                    <div className={styles.poolTeamList}>
                      {pool.teams.map(t => (
                        <div key={t.id} className={styles.poolTeamRow}>{t.name}</div>
                      ))}
                    </div>
                    <div className={styles.poolMatchList}>
                      {pool.matches.map(m => (
                        <div key={m.id} className={styles.poolMatchRow}>
                          <span className={`${styles.poolMatchName} ${m.winner === 'A' ? styles.poolMatchNameWin : ''}`}>
                            {m.teamAName}
                          </span>
                          <span className={styles.poolMatchScore}>
                            {m.status === 'done' && m.scoreA && m.scoreB
                              ? m.scoreA.map((s, i) => `${s}-${m.scoreB?.[i] ?? 0}`).join(', ')
                              : m.status === 'live' ? 'Live' : 'vs'}
                          </span>
                          <span className={`${styles.poolMatchName} ${m.winner === 'B' ? styles.poolMatchNameWin : ''}`}>
                            {m.teamBName}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ── Round 2: single elimination ────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Round 2 · Single Elimination</h2>
          <p className={styles.sectionSubSpaced}>
            {firstRoundMatches * 2 || 'No'}-team single elimination · {division?.label ?? '—'} ·{' '}
            {bracket?.fromDb ? 'generated draw' : 'projected from current seeding'}
          </p>
          {bracket ? (
            <div className={styles.bracketScroll}>
              <div className={styles.bracketRow}>
                {bracket.rounds.map(round => (
                  <div key={round.name} className={styles.roundCol}>
                    <div className={styles.roundName}>{round.name}</div>
                    <div className={styles.roundMatches} style={{ height: colHeight }}>
                      {round.matches.map((m, mi) => (
                        <div key={mi} className={styles.matchSlot}>
                          <div className={styles.matchCard}>
                            {m.live && (
                              <div className={styles.matchLiveRow}>
                                <span className={styles.liveTag}>
                                  <span className={styles.liveTagDot} aria-hidden="true" />
                                  Live
                                </span>
                              </div>
                            )}
                            <div className={styles.matchRow}>
                              <span className={styles.matchSeed}>{m.rowA.seed ?? '–'}</span>
                              <span className={rowClass(m.rowA)}>{m.rowA.name}</span>
                            </div>
                            <div className={styles.matchDivider} />
                            <div className={styles.matchRow}>
                              <span className={styles.matchSeed}>{m.rowB.seed ?? '–'}</span>
                              <span className={rowClass(m.rowB)}>{m.rowB.name}</span>
                            </div>
                          </div>
                          {m.hasRight && <div className={styles.connRight} />}
                          {m.hasSpine && <div className={styles.connSpine} />}
                          {m.hasLeft && <div className={styles.connLeft} />}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div className={styles.champCol}>
                  <div className={styles.champLabel}>Champion</div>
                  <div className={styles.champSlot} style={{ height: colHeight }}>
                    <div className={styles.champCard}>
                      <span className={styles.champTrophy}><Trophy size={30} /></span>
                      <span className={styles.champEyebrow}>
                        {bracket.fromDb ? (bracket.champion ? 'Champion' : 'Awaiting Final') : 'Projected Winner'}
                      </span>
                      <span className={styles.champName}>
                        {bracket.champion ?? (bracket.fromDb ? 'TBD' : seeds[0]?.name ?? 'TBD')}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.emptyNote}>
              The bracket will appear here once at least two teams are registered.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
