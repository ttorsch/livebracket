'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import AuthShell from '../../components/auth/AuthShell';
import shell from '../../components/auth/AuthShell.module.css';
import { supabase } from '../../lib/supabase';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /* Landing here without a session means the recovery link was already
   * used, expired, or the page was opened directly. Say so rather than
   * showing a form whose submit can only fail. */
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data }) => setHasSession(!!data.user))
      .catch(() => setHasSession(false))
      .finally(() => setChecking(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (password !== confirm) {
      setErrorMsg('The two passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErrorMsg(error.message);
        return;
      }
      /* The recovery session is a live session; sign out so the new
       * password is actually used to get back in, and land them on the
       * login form rather than silently inside the app. */
      await supabase.auth.signOut();
      await fetch('/api/auth/signout', { method: 'POST' });
      router.push('/login?reset=1');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not update the password.');
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <AuthShell title="Set a new password">
        <p className={shell.hint}>Checking your link…</p>
      </AuthShell>
    );
  }

  if (!hasSession) {
    return (
      <AuthShell
        title="This link has expired"
        footer={<Link href="/login" className={shell.link}>Back to log in</Link>}
      >
        <div className={shell.done}>
          <span className={`${shell.doneIcon} ${shell.doneIconWarn}`}><ShieldAlert size={26} /></span>
          <p>Password reset links can only be used once, and expire after an hour.</p>
          <div className={shell.doneActions}>
            <Link href="/forgot-password" className={shell.primaryAction}>
              Send a new link
            </Link>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Set a new password"
      subtitle="Choose a password you haven't used on Live Bracket before."
      footer={<Link href="/login" className={shell.link}>Back to log in</Link>}
    >
      {errorMsg && <div className={shell.alertError}>{errorMsg}</div>}

      <form className={shell.form} onSubmit={handleSubmit}>
        <label className={shell.field}>
          <span>New password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            minLength={8}
            autoComplete="new-password"
            required
          />
        </label>
        <label className={shell.field}>
          <span>Confirm new password</span>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Type it again"
            minLength={8}
            autoComplete="new-password"
            required
          />
        </label>
        <button type="submit" className={shell.submit} disabled={loading}>
          {loading ? 'Saving…' : 'Save new password'}
        </button>
      </form>
    </AuthShell>
  );
}
