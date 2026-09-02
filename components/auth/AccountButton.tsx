'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { User, LayoutDashboard, LogOut } from 'lucide-react';
import { initialsFor, isOrganizer } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { useSession } from './AuthProvider';
import styles from './AccountButton.module.css';

/* What a signed-in visitor sees in the header where "Sign In" used to be.
 *
 * It renders nothing at all when signed out — the caller keeps owning the
 * signed-out controls.
 *
 * Clicking the avatar opens a dropdown menu that allows switching between
 * the Player Profile, Organizer Dashboard (if they have the organizer role),
 * and Logging out. */
export default function AccountButton({
  className,
  onNavigate,
}: {
  className?: string;
  /* Lets a header save its scroll position (or close its mobile menu)
     before the navigation, the same way its sign-in link does. */
  onNavigate?: () => void;
}) {
  const session = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!session.signedIn) return null;

  const label = session.name?.trim() || session.email || 'your account';
  const organizer = isOrganizer(session);

  const handleLogout = async () => {
    setIsOpen(false);
    onNavigate?.();
    try {
      await supabase.auth.signOut();
      /* Clearing the browser session is only half of it — the auth cookie
       * has to go too, or middleware and server components keep treating
       * this visitor as signed in. */
      await fetch('/api/auth/signout', { method: 'POST' });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      window.location.href = '/';
    }
  };

  const handleItemClick = () => {
    setIsOpen(false);
    onNavigate?.();
  };

  return (
    <div className={className ? `${styles.wrapper} ${className}` : styles.wrapper} ref={menuRef}>
      <button
        type="button"
        className={styles.button}
        onClick={() => setIsOpen(prev => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        title={label}
        aria-label={`Account menu — ${label}`}
      >
        {session.avatarUrl ? (
          <img src={session.avatarUrl} alt="" className={styles.avatar} />
        ) : (
          <span className={styles.initials} aria-hidden="true">
            {initialsFor(session)}
          </span>
        )}
      </button>

      {isOpen && (
        <div className={styles.dropdown} role="menu" aria-label="Account menu">
          <Link
            href="/profile"
            className={styles.menuItem}
            role="menuitem"
            onClick={handleItemClick}
          >
            <User size={15} className={styles.menuIcon} aria-hidden="true" />
            <span>Profile page</span>
          </Link>

          {organizer && (
            <Link
              href="/dashboard"
              className={styles.menuItem}
              role="menuitem"
              onClick={handleItemClick}
            >
              <LayoutDashboard size={15} className={styles.menuIcon} aria-hidden="true" />
              <span>Organizer dashboard</span>
            </Link>
          )}

          <div className={styles.divider} role="separator" />

          <button
            type="button"
            className={`${styles.menuItem} ${styles.logoutItem}`}
            role="menuitem"
            onClick={handleLogout}
          >
            <LogOut size={15} className={styles.menuIcon} aria-hidden="true" />
            <span>Log out</span>
          </button>
        </div>
      )}
    </div>
  );
}
