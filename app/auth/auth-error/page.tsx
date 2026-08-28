import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import AuthShell from '../../../components/auth/AuthShell';
import shell from '../../../components/auth/AuthShell.module.css';

export const metadata = {
  title: 'Sign-in problem · Live Bracket',
};

/* Every failure path out of /auth/callback ends up here — an expired
 * confirmation link, a cancelled Google consent screen, a code that was
 * already spent. One page so none of those dead-end on a raw error. */
export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;

  return (
    <AuthShell
      title="That link didn't work"
      footer={<Link href="/" className={shell.link}>Browse events instead</Link>}
    >
      <div className={shell.done}>
        <span className={`${shell.doneIcon} ${shell.doneIconWarn}`}><ShieldAlert size={26} /></span>
        <p>
          {message
            ? message
            : 'The sign-in link was invalid or has already been used. Links expire an hour after they are sent.'}
        </p>
        <div className={shell.doneActions}>
          <Link href="/login" className={shell.primaryAction}>Back to log in</Link>
        </div>
      </div>
    </AuthShell>
  );
}
