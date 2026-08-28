'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MailCheck } from 'lucide-react';
import AuthShell from '../../components/auth/AuthShell';
import shell from '../../components/auth/AuthShell.module.css';
import { supabase } from '../../lib/supabase';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        /* The recovery link has to come back through the callback so its
         * code is exchanged for a session server-side; /reset-password on
         * its own would have no session to change the password with. */
        redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
      });
      if (error) {
        setErrorMsg(error.message);
        return;
      }
      setSent(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not send the reset link.');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <AuthShell
        title="Check your inbox"
        footer={<Link href="/login" className={shell.link}>Back to log in</Link>}
      >
        <div className={shell.done}>
          <span className={shell.doneIcon}><MailCheck size={26} /></span>
          <p>
            If an account exists for <strong>{email.trim()}</strong>, a link to set a new
            password is on its way. It expires in one hour.
          </p>
          <p className={shell.hint}>
            Nothing arrived? Check spam, or try again in a few minutes.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email you signed up with and we'll send you a link to set a new password."
      footer={<Link href="/login" className={shell.link}>Back to log in</Link>}
    >
      {errorMsg && <div className={shell.alertError}>{errorMsg}</div>}

      <form className={shell.form} onSubmit={handleSubmit}>
        <label className={shell.field}>
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </label>
        <button type="submit" className={shell.submit} disabled={loading}>
          {loading ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
    </AuthShell>
  );
}
