import Link from 'next/link';
import styles from './page.module.css';

export const metadata = {
  title: 'Privacy & cookies · Live Bracket',
  description:
    'What Live Bracket stores, the one cookie it sets, how location is used, and who processes the data.',
};

/* A stub, deliberately: it states only what the code actually does, which
 * is the part an engineer can verify and keep true. Every claim here maps
 * to something real —
 *   the auth cookie      → lib/supabase.ts (createBrowserClient)
 *   the consent cookie   → lib/consent.ts
 *   location + Nominatim → app/page.tsx, the geolocation effect
 * If you change one of those, change the matching paragraph.
 *
 * The bracketed items are the ones only the operator can fill in — the
 * legal entity and a contact address. They are left visible rather than
 * invented, because a policy naming the wrong controller is worse than one
 * that is obviously unfinished. */
export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <div className={styles.doc}>
        <Link href="/" className={styles.back}>&larr; Back to Live Bracket</Link>

        <h1 className={styles.title}>Privacy &amp; cookies</h1>
        <p className={styles.updated}>Last updated 5 September 2026</p>

        <p className={styles.lede}>
          Live Bracket is a tournament bracket and live-scoring site. You can browse
          tournaments, brackets and scores without an account, without being tracked,
          and without accepting anything.
        </p>

        <section className={styles.section}>
          <h2 className={styles.h2}>Cookies we set</h2>
          <p>We set two cookies, and no others. There are no advertising or tracking cookies on this site.</p>

          <table className={styles.table}>
            <thead>
              <tr>
                <th>Cookie</th>
                <th>Purpose</th>
                <th>Lifetime</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>sb-…-auth-token</code></td>
                <td>
                  Keeps you signed in. Set only after you log in, and removed when you
                  log out. Strictly necessary, so it is not subject to consent.
                </td>
                <td>Until logout or expiry</td>
              </tr>
              <tr>
                <td><code>lb_consent</code></td>
                <td>Remembers your answer to the cookie banner, so we stop asking.</td>
                <td>6 months</td>
              </tr>
            </tbody>
          </table>

          <p>
            Accepting the banner does not switch anything on today &mdash; we do not
            currently run analytics. It records permission to add anonymous usage
            analytics in future. If you reject, that stays off, and the site works
            exactly the same.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>Location</h2>
          <p>
            The homepage can show which tournaments are near you. If your browser
            offers to share your location and you allow it, we send those coordinates
            once to OpenStreetMap&rsquo;s Nominatim service to turn them into a place
            name (for example &ldquo;Khao Lak, Phang Nga, Thailand&rdquo;).
          </p>
          <p>
            We do not store your coordinates, and they are never attached to your
            account. Decline the browser prompt and the page simply shows a default
            location. Your browser remembers that choice; you can change it in its
            site settings at any time.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>Account and tournament data</h2>
          <p>
            If you create an account or register for a tournament, we store what you
            enter &mdash; typically name, email and team details &mdash; so organizers can
            run the draw and publish results. Player names, teams and scores appear on
            public tournament pages, which is the point of the service.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>Who processes this data</h2>
          <ul className={styles.list}>
            <li><strong>Supabase</strong> &mdash; database, authentication and file storage.</li>
            <li><strong>Vercel</strong> &mdash; hosting and delivery of the site.</li>
            <li>
              <strong>OpenStreetMap / Nominatim</strong> &mdash; converts coordinates to a
              place name, only if you allow location access.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>Your rights</h2>
          <p>
            You can ask for a copy of your data, ask us to correct it, or ask us to
            delete your account and the data attached to it. Under Thailand&rsquo;s PDPA
            and, where it applies, the GDPR, you can also withdraw consent or object to
            processing. Contact us and we will action it.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>Contact</h2>
          <p className={styles.todo}>
            [Add the legal entity responsible for this site and a contact email address
            before publishing. This page is a factual starting point written from the
            application&rsquo;s actual behaviour &mdash; it has not been reviewed by a lawyer.]
          </p>
        </section>
      </div>
    </main>
  );
}
