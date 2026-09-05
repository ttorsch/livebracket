'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw, LogOut, Clock, Sparkles } from 'lucide-react';
import { useSession } from './auth/AuthProvider';
import styles from './DemoBanner.module.css';

function formatRemaining(expiresAt: string): string {
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) return 'Expired';

  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export default function DemoBanner() {
  const session = useSession();
  const router = useRouter();
  const [remaining, setRemaining] = useState<string>('');
  const [isResetting, setIsResetting] = useState(false);

  const sandbox = session.sandbox;

  useEffect(() => {
    if (!sandbox?.expiresAt) return;

    const updateCountdown = () => {
      setRemaining(formatRemaining(sandbox.expiresAt));
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, [sandbox?.expiresAt]);

  if (!sandbox) return null;

  const handleReset = async () => {
    if (isResetting) return;
    const confirmed = window.confirm(
      'Reset your demo tournament? This will wipe your edits and restore the clean golden template with live scores.'
    );
    if (!confirmed) return;

    try {
      setIsResetting(true);
      const res = await fetch('/api/demo/reset', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Reset failed');
      }
      window.location.reload();
    } catch (err: any) {
      alert(`Could not reset demo: ${err?.message || 'Server error'}`);
      setIsResetting(false);
    }
  };

  const handleExit = async () => {
    try {
      await fetch('/api/auth/signout', { method: 'POST' });
      window.location.href = '/';
    } catch {
      window.location.href = '/';
    }
  };

  return (
    <div className={styles.banner} role="status" aria-label="Demo sandbox notification">
      <div className={styles.container}>
        <div className={styles.left}>
          <span className={styles.badge}>
            <span className={styles.pulseDot} />
            <Sparkles size={12} />
            Demo Sandbox
          </span>
          <span className={styles.message}>
            Private organizer copy. Touch anything — nothing affects real events.
          </span>
          {remaining && (
            <span className={styles.countdown} title={`Expires at ${new Date(sandbox.expiresAt).toLocaleTimeString()}`}>
              <Clock size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: -1 }} />
              Expires in {remaining}
            </span>
          )}
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.resetButton}
            onClick={handleReset}
            disabled={isResetting}
            title="Wipe changes and restore golden template"
          >
            <RotateCcw size={12} className={isResetting ? 'animate-spin' : ''} />
            {isResetting ? 'Resetting…' : 'Start over'}
          </button>
          <button
            type="button"
            className={styles.exitButton}
            onClick={handleExit}
            title="Exit demo session"
          >
            <LogOut size={12} />
            Exit
          </button>
        </div>
      </div>
    </div>
  );
}
