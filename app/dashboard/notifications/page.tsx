'use client';

import NotificationsScreen from '@/components/NotificationsScreen';
import { useAuth } from '@/components/auth/AuthProvider';

/* The organizer's list, in full. `organizer` is what keeps it about the
 * events: teams entering and teams changing their own entries, with the
 * same account's invitations and thumbs left on /notifications where they
 * belong. The organizer gate is app/dashboard/layout.tsx, which this
 * route inherits by living under it. */
export default function DashboardNotificationsPage() {
  const { session } = useAuth();

  return (
    <NotificationsScreen
      userId={session.userId}
      audience="organizer"
      backHref="/dashboard"
      backLabel="Dashboard"
    />
  );
}
