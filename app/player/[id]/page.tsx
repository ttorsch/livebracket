import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, MapPin } from 'lucide-react';
import styles from './page.module.css';
import { getCurrentUser } from '../../../lib/auth';
import { getPlayerCard } from '../../../lib/playerCard';

/* ── A player's public page ───────────────────────────────────────
 *
 * Where "See more" on the player card goes. Same identity, the same
 * record, and the results behind it — the card answers "who is this",
 * this answers "and how have they been playing".
 *
 * A server component, so the disclosure rule is applied where the session
 * actually is: club, hometown and player ID reach a signed-in reader and
 * nobody else. See lib/playerCard.ts.
 *
 * Addressed by account id rather than by the 8-digit player ID, which is
 * the key to inviting someone onto a team and is not for putting in URLs
 * that public pages link to.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECENT = 10;

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return name.trim()[0]?.toUpperCase() || '?';
}

function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const viewer = await getCurrentUser();
  const card = await getPlayerCard(id, {
    includePrivate: !!viewer,
    viewerId: viewer?.id ?? null,
    recentLimit: RECENT,
  });
  if (!card) notFound();

  const name = card.name || 'Player';
  const place = [card.club, card.hometown].filter(Boolean).join(' · ');
  const r = card.record;

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <Link href="/" className={styles.back}>
          <ArrowLeft size={16} aria-hidden="true" /> Home
        </Link>

        <header className={styles.identity}>
          <div className={styles.avatar}>
            {card.avatarUrl
              ? /* eslint-disable-next-line @next/next/no-img-element */
                <img src={card.avatarUrl} alt="" />
              : <span>{initials(name)}</span>}
          </div>
          <div className={styles.identityText}>
            <p className={styles.eyebrow}>Player</p>
            <h1 className={styles.name}>{name}</h1>
            {place && (
              <p className={styles.place}>
                <MapPin size={14} aria-hidden="true" /> {place}
              </p>
            )}
            {card.playerId && (
              <p className={styles.playerId}>
                <span className={styles.playerIdLabel}>Player ID</span>
                <span className={styles.playerIdValue}>{card.playerId}</span>
              </p>
            )}
            {!viewer && (
              <p className={styles.gated}>
                <Link href={`/login?next=/player/${id}`} className={styles.gatedLink}>Sign in</Link>{' '}
                to see this player&apos;s club, hometown and player ID.
              </p>
            )}
          </div>
        </header>

        <section className={styles.pane} aria-label="Performance">
          <h2 className={styles.paneTitle}>Performance</h2>
          {r.matchesCount === 0 ? (
            <p className={styles.paneNote}>No completed matches yet.</p>
          ) : (
            <>
              <div className={styles.statGrid}>
                <div className={styles.stat}>
                  <span className={styles.statValue}>{r.matchesCount}</span>
                  <span className={styles.statLabel}>Matches</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statValue}>{r.wins}–{r.losses}</span>
                  <span className={styles.statLabel}>W–L</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statValue}>{r.winRate}%</span>
                  <span className={styles.statLabel}>Win rate</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statValue}>{r.setsWon}–{r.setsLost}</span>
                  <span className={styles.statLabel}>Sets</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statValue}>{r.longestStreak}</span>
                  <span className={styles.statLabel}>Best streak</span>
                </div>
              </div>
              {r.bestFinish && (
                <p className={styles.bestFinish}>
                  <span>Best finish</span>
                  <strong>{r.bestFinish}</strong>
                </p>
              )}
            </>
          )}
        </section>

        <section className={styles.pane} aria-label="Recent results">
          <h2 className={styles.paneTitle}>Recent results</h2>
          {card.recent.length === 0 ? (
            <p className={styles.paneNote}>Nothing played yet.</p>
          ) : (
            <ul className={styles.results}>
              {card.recent.map(m => (
                <li key={m.matchId} className={styles.result}>
                  <span
                    className={`${styles.outcome} ${m.won ? styles.outcomeWin : styles.outcomeLoss}`}
                    aria-label={m.won ? 'Won' : 'Lost'}
                  >
                    {m.won ? 'W' : 'L'}
                  </span>
                  <span className={styles.resultText}>
                    <span className={styles.resultOpponent}>vs {m.opponent}</span>
                    <span className={styles.resultMeta}>
                      {m.tournamentSlug ? (
                        <Link href={`/tournament/${m.tournamentSlug}`} className={styles.resultLink}>
                          {m.tournamentTitle}
                        </Link>
                      ) : (
                        m.tournamentTitle
                      )}
                      {m.divisionName ? ` · ${m.divisionName}` : ''}
                      {m.roundName ? ` · ${m.roundName}` : ''}
                      {shortDate(m.date) ? ` · ${shortDate(m.date)}` : ''}
                    </span>
                  </span>
                  <span className={styles.resultScore}>{m.score}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
