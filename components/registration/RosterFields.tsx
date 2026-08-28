'use client';

import { useState } from 'react';
import { Search, X } from 'lucide-react';
import { Avatar, SegmentedControl } from '@/components/livebracket-ds';
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
  nationality: string;
  club: string;
  /* Set when the slot was filled by player-ID search. Names an account;
   * does not speak for one — the invite does that. */
  userId?: string | null;
}

export interface RosterContact {
  email: string;
  phone: string;
}

interface RosterFieldsProps {
  players: RosterPlayer[];
  onPlayerChange: (index: number, patch: Partial<RosterPlayer>) => void;
  contact: RosterContact;
  onContactChange: (patch: Partial<RosterContact>) => void;
  /* The division's own apparel options, so a division offering XS–XXL is
   * not quietly forced onto the default four. */
  sizes: string[];
  required?: {
    name?: boolean;
    contact?: boolean;
    nationality?: boolean;
    club?: boolean;
  };
  /* Search needs a session. The public form may be anonymous, and an
   * organizer is by definition signed in. */
  searchEnabled?: boolean;
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
  sizes,
  required = {},
  searchEnabled = true,
}: RosterFieldsProps) {
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
              {searchEnabled && (
                <button
                  type="button"
                  className={`${styles.playerSearchBtn} ${openIdx === i ? styles.playerSearchBtnActive : ''}`}
                  onClick={() => toggleSearch(i)}
                  title={openIdx === i ? 'Close search' : 'Search player by ID'}
                  aria-label="Search player by ID"
                >
                  {openIdx === i ? <X size={15} /> : <Search size={15} />}
                </button>
              )}
            </div>

            {openIdx === i && (
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

            <div className={styles.playerExtras}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Apparel size</span>
                <SegmentedControl
                  options={sizes}
                  value={player.shirtSize}
                  onChange={val => onPlayerChange(i, { shirtSize: val })}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${sizes.length}, minmax(0, 1fr))`,
                    width: '100%',
                  }}
                />
              </div>
              <div className={styles.playerExtraPair}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>
                    Nationality {required.nationality && <span className={styles.req}>*</span>}
                  </span>
                  <input
                    className={styles.input}
                    placeholder="Thailand"
                    value={player.nationality}
                    onChange={e => onPlayerChange(i, { nationality: e.target.value })}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>
                    Club / hometown {required.club && <span className={styles.req}>*</span>}
                  </span>
                  <input
                    className={styles.input}
                    placeholder="KLV"
                    value={player.club}
                    onChange={e => onPlayerChange(i, { club: e.target.value })}
                  />
                </label>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
