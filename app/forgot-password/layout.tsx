import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Reset your password · Live Bracket',
  description: 'Send yourself a link to set a new Live Bracket password.',
};

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
