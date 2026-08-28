import Link from 'next/link';
import styles from './AuthShell.module.css';

/* The beach-hero + glass-card frame shared by every standalone auth screen
 * (forgot password, reset password, confirmation, link errors), so those
 * pages read as part of the same moment as /login instead of as four
 * unrelated forms. /login keeps its own two-column layout; this is the
 * single-column sibling. */
export function BrandMark() {
  return (
    <svg viewBox="296 73 687 687" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
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
  );
}

interface AuthShellProps {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export default function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand} aria-label="Live Bracket — home">
          <span className={styles.brandMark}><BrandMark /></span>
          Live Bracket
        </Link>
        <Link href="/" className={styles.topBack}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M12 7H2m0 0l4 4M2 7l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Browse events
        </Link>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroBg} aria-hidden="true">
          <img src="/images/Hero.jpg" alt="" className={styles.heroImg} />
          <div className={styles.heroScrim} />
        </div>

        <div className={styles.glassPanel}>
          <div className={styles.card}>
            <h1 className={styles.title}>{title}</h1>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
            {children}
            {footer && <div className={styles.footer}>{footer}</div>}
          </div>
        </div>
      </section>
    </div>
  );
}
