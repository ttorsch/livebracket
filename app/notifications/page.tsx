'use client';

import Link from 'next/link';
import { MessageSquare, Settings, LogOut } from 'lucide-react';
import NotificationsScreen from '@/components/NotificationsScreen';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/auth/AuthProvider';

/* The player's list, in full. `personal` for the same reason the profile
 * is — an organizer's registrations and roster edits are addressed to
 * this account but belong on the dashboard, which has its own. */
export default function NotificationsPage() {
  const { session } = useAuth();

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      /* Clearing the browser session is only half of it — the auth
         cookie is the server's copy. Same pairing as the profile. */
      await fetch('/api/auth/signout', { method: 'POST' });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      window.location.href = '/';
    }
  };

  return (
    <NotificationsScreen
      userId={session.userId}
      audience="personal"
      backHref="/profile"
      backLabel="Profile"
      actions={
        <>
          <button type="button" title="Chat" aria-label="Chat" onClick={() => {}}>
            <MessageSquare size={21} strokeWidth={1.8} />
          </button>
          <Link href="/profile" title="Settings" aria-label="Settings">
            <Settings size={21} strokeWidth={1.8} />
          </Link>
          <button type="button" title="Log out" aria-label="Log out" onClick={handleLogout}>
            <LogOut size={21} strokeWidth={1.8} />
          </button>
        </>
      }
    />
  );
}
