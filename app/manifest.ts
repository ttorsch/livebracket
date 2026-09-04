import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Live Bracket',
    short_name: 'Live Bracket',
    description: 'Beach volleyball tournament brackets and live scores',
    start_url: '/',
    display: 'standalone',
    background_color: '#EB6F43',
    theme_color: '#EB6F43',
    icons: [
      {
        src: '/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}
