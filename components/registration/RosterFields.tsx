'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Search, X } from 'lucide-react';
import { Avatar, SegmentedControl } from '@/components/livebracket-ds';
import { useSignInHref } from '@/components/auth/useSignInHref';
import { type RegField, SKILL_LEVELS } from '@/lib/registrationFields';
import CountrySelect from './CountrySelect';
import styles from './RosterFields.module.css';

/* The roster half of a team entry — the team contact block and one card
 * per player, with player-ID search on each.
 *
 * Shared by the public registration form (step 2) and the organizer's Add
 * Team modal so the two are the same thing rather than two things that
 * look alike. The only difference between the callers is what is
 * enforced, which is why `required` is a prop and nothing else is: an
 * organizer typing in a team they took a photo of at the beach should not
 * be blocked for a missing shirt size, but the field is still there when
 * they know it. */

export interface RosterPlayer {
  name: string;
  shirtSize: string;
  skill: string;
  nationality: string;
  club: string;
  /* Set when the slot was filled by player-ID search. Names an account;
   * does not speak for one — the invite does that. */
  userId?: string | null;
}

/* Where a division offers no apparel question of its own. */
const DEFAULT_SIZES = ['S', 'M', 'L', 'XL'];

export interface RosterContact {
  email: string;
  phone: string;
}

interface RosterFieldsProps {
  players: RosterPlayer[];
  onPlayerChange: (index: number, patch: Partial<RosterPlayer>) => void;
  contact: RosterContact;
  onContactChange: (patch: Partial<RosterContact>) => void;
  /* The division's own questions. The form renders the presets this
   * division actually added and nothing else — it used to hardcode
   * apparel, nationality and club regardless, so a division that never
   * asked for a nationality got the box anyway. */
  fields: RegField[];
  required?: {
    name?: boolean;
    contact?: boolean;
    nationality?: boolean;
    club?: boolean;
  };
  /* Whether the visitor has a session. The lookup endpoint requires one,
   * so this decides what the search panel offers — not whether the search
   * exists. Hiding the control outright made the feature look like it had
   * been removed; now it explains itself and links to sign-in. An
   * organizer is signed in by definition, hence the default. */
  signedIn?: boolean;
}

interface FoundPlayer {
  userId: string;
  playerId: string;
  name: string | null;
  avatarUrl: string | null;
}

export default function RosterFields({
  players,
  onPlayerChange,
  contact,
  onContactChange,
  fields,
  required = {},
  signedIn = true,
}: RosterFieldsProps) {
  const signInHref = useSignInHref('player');

  /* The four presets this division may have added, looked up once. The
   * `required` prop is gone from these — each field carries its own flag,
   * which is what the organizer actually toggled. */
  const preset = (key: RegField['preset']) => fields.find(f => f.preset === key) ?? null;
  const apparel = preset('apparel');
  const skill = preset('skill');
  const nationality = preset('nationality');
  const hometown = preset('hometown');

  const apparelOptions = apparel?.options?.length ? apparel.options : DEFAULT_SIZES;
  const skillOptions = skill?.options?.length ? skill.options : [...SKILL_LEVELS];
  /* Search state is per card and lives here rather than in either page,
   * which is most of why this is a component at all. */
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<FoundPlayer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resetSearch = () => {
    setQuery('');
    setFound(null);
    setError(null);
  };

  const toggleSearch = (idx: number) => {
    setOpenIdx(current => (current === idx ? null : idx));
    resetSearch();
  };

  const runSearch = async () => {
    const id = query.trim();
    if (!id) return;
    setSearching(true);
    setError(null);
    setFound(null);
    try {
      const res = await fetch(`/api/players/lookup?playerId=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Player not found');
      } else {
        setFound(data.player as FoundPlayer);
      }
    } catch {
      setError('Could not reach the server');
    } finally {
      setSearching(false);
    }
  };

  /* Only the name and the account link are taken from a lookup. The
   * endpoint returns nothing else on purpose — an 8-digit code is the
   * only thing gating it, so what comes back through it stays to the
   * minimum needed to confirm you found the right person. Shirt size and
   * the rest are this team's answers to give. */
  const applyFound = (idx: number, player: FoundPlayer) => {
    onPlayerChange(idx, { name: player.name ?? '', userId: player.userId });
    setOpenIdx(null);
    resetSearch();
  };

  return (
    /* The query container — the layout below follows this element's
       width, so the same component lays out correctly in a wide
       registration card and in a narrower modal. */
    <div className={styles.root}>
      <div className={styles.fieldSet}>
        <span className={styles.sectionLabel}>Team contact</span>
        <div className={styles.contactGrid}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Email {required.contact && <span className={styles.req}>*</span>}
            </span>
            <input
              className={styles.input}
              type="email"
              autoComplete="email"
              placeholder="captain@email.com"
              value={contact.email}
              onChange={e => onContactChange({ email: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Phone / WhatsApp {required.contact && <span className={styles.req}>*</span>}
            </span>
            <input
              className={styles.input}
              type="tel"
              autoComplete="tel"
              placeholder="+66 __ ___ ____"
              value={contact.phone}
              onChange={e => onContactChange({ phone: e.target.value })}
            />
          </label>
        </div>
      </div>

      <div className={styles.playerGrid}>
        {players.map((player, i) => (
          <div key={i} className={styles.playerCard}>
            <div className={styles.playerHead}>
              <div className={styles.playerHeadLeft}>
                <span className={styles.playerNum}>{i + 1}</span>
                <span className={styles.playerName}>Player {i + 1}</span>
              </div>
              <button
                type="button"
                className={`${styles.playerSearchBtn} ${openIdx === i ? styles.playerSearchBtnActive : ''}`}
                onClick={() => toggleSearch(i)}
                title={openIdx === i ? 'Close search' : 'Search player by ID'}
                aria-label="Search player by ID"
              >
                {openIdx === i ? <X size={15} /> : <Search size={15} />}
              </button>
            </div>

            {openIdx === i && !signedIn && (
              <div className={styles.playerSearchBox}>
                <span className={styles.playerSearchNote}>
                  <Link href={signInHref} className={styles.playerSearchSignIn}>Sign in</Link>
                  {' '}to add a teammate by their player ID. You can still register by
                  typing everyone&apos;s details in.
                </span>
              </div>
            )}

            {openIdx === i && signedIn && (
              <div className={styles.playerSearchBox}>
                <div className={styles.playerSearchInputRow}>
                  <input
                    type="text"
                    inputMode="numeric"
                    className={styles.playerSearchInput}
                    placeholder="Enter 8-digit Player ID"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        runSearch();
                      }
                    }}
                    autoFocus
                  />
                  <button
                    type="button"
                    className={styles.playerSearchSubmitBtn}
                    onClick={runSearch}
                    disabled={searching || !query.trim()}
                  >
                    {searching ? 'Searching…' : 'Find'}
                  </button>
                </div>
                {error && <span className={styles.playerSearchError}>{error}</span>}
                {found && (
                  <div className={styles.playerSearchResult}>
                    <Avatar name={found.name ?? ''} src={found.avatarUrl ?? undefined} size={34} />
                    <div className={styles.playerSearchResultInfo}>
                      <span className={styles.playerSearchResultName}>{found.name ?? 'Player'}</span>
                      <span className={styles.playerSearchResultMeta}>ID: {found.playerId}</span>
                    </div>
                    <button
                      type="button"
                      className={styles.playerSearchApplyBtn}
                      onClick={() => applyFound(i, found)}
                    >
                      Use player
                    </button>
                  </div>
                )}
              </div>
            )}

            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                Full name {required.name && <span className={styles.req}>*</span>}
              </span>
              <input
                className={styles.input}
                placeholder={i === 0 ? 'e.g. Anna Sirisai' : 'e.g. Mai Chaiyo'}
                value={player.name}
                onChange={e => onPlayerChange(i, { name: e.target.value, userId: null })}
              />
            </label>

            {/* Only the presets this division added. Each one has a
                defined control — the point of a preset is that the same
                question looks and answers the same way across events. */}
            {(apparel || skill || nationality || hometown) && (
              <div className={styles.playerExtras}>
                {apparel && (
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>
                      {apparel.label} {apparel.required && <span className={styles.req}>*</span>}
                    </span>
                    <SegmentedControl
                      options={apparelOptions}
                      value={player.shirtSize}
                      onChange={val => onPlayerChange(i, { shirtSize: val })}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${apparelOptions.length}, minmax(0, 1fr))`,
                        width: '100%',
                      }}
                    />
                  </div>
                )}

                {skill && (
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>
                      {skill.label} {skill.required && <span className={styles.req}>*</span>}
                    </span>
                    {/* A dropdown rather than apparel's segmented pills:
                        five word-length labels never fit a card's width in
                        one row, and wrapping them to two rows made the
                        control taller than the answer is worth. */}
                    <div className={styles.selectWrap}>
                      <select
                        className={styles.select}
                        value={player.skill}
                        onChange={e => onPlayerChange(i, { skill: e.target.value })}
                      >
                        <option value="">Select a level</option>
                        {skillOptions.map(level => (
                          <option key={level} value={level}>{level}</option>
                        ))}
                      </select>
                      <ChevronDown size={15} className={styles.selectChevron} aria-hidden="true" />
                    </div>
                  </div>
                )}

                <div className={styles.playerExtraPair}>
                  {nationality && (
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>
                        {nationality.label} {nationality.required && <span className={styles.req}>*</span>}
                      </span>
                      <CountrySelect
                        value={player.nationality}
                        onChange={country => onPlayerChange(i, { nationality: country })}
                      />
                    </label>
                  )}
                  {hometown && (
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>
                        {hometown.label} {hometown.required && <span className={styles.req}>*</span>}
                      </span>
                      <input
                        className={styles.input}
                        placeholder="KLV"
                        value={player.club}
                        onChange={e => onPlayerChange(i, { club: e.target.value })}
                      />
                    </label>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
