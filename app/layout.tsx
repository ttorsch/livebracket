import type { Metadata } from 'next';
import '../components/livebracket-ds/styles.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Live Bracket | Beach volleyball tournaments in Khao Lak',
  description:
    'Browse live and upcoming beach volleyball tournaments in Khao Lak. Follow brackets and real-time scores — no account needed. Organizers log in to run their own.',
  keywords: [
    'live bracket',
    'tournament bracket',
    'beach volleyball',
    'tournament software',
    'live scores',
    'Khao Lak Volley',
  ],
  openGraph: {
    title: 'Live Bracket',
    description: 'Real-time tournament brackets for beach volleyball organizers and players.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bagel+Fat+One&family=Faculty+Glyphic&family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500;1,9..144,600&family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&family=Poppins:wght@400;600;700&family=DM+Sans:wght@400;500&family=Montserrat:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body suppressHydrationWarning className="livebracket-app">
        {children}
      </body>
    </html>
  );
}
