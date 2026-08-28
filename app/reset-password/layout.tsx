import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Set a new password · Live Bracket',
  // Recovery links must never be indexed or previewed by a link scanner —
  // a crawler that follows one spends the single-use code before the person does.
  robots: { index: false, follow: false },
};

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
