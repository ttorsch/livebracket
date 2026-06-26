import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Log in · Live Bracket',
  description: 'Log in to Live Bracket to create a tournament, manage your team, or score matches court-side.',
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
