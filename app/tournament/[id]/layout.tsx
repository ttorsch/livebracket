import type { Metadata } from 'next';

/* Metadata guardrail for demo tournaments:
 * Ensures the golden template and any ephemeral cloned sandbox tournaments
 * carry noindex/nofollow so search engines never crawl or index demo pages. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const isDemoSlug =
    id === 'andaman-beach-masters-template' ||
    id.startsWith('andaman-masters-') ||
    id.includes('demo');

  if (isDemoSlug) {
    return {
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  return {};
}

export default function TournamentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
