'use client';
/* TEMPORARY — scratch route for visually checking the profile redesign
   without a session. Delete before committing. */
import { AuthProvider } from '@/components/auth/AuthProvider';
import PlayerProfile from '../profile/page';

export default function Preview() {
  return (
    <AuthProvider
      initialSession={{
        signedIn: true,
        roles: ['player', 'organizer'],
        userId: 'preview',
        organizerId: 'preview',
        email: 'tor@example.com',
        name: 'Tor Saengchai',
        club: 'Khao Lak Volley',
        hometown: 'Khao Lak, Thailand',
        avatarUrl: null,
      }}
    >
      <PlayerProfile />
    </AuthProvider>
  );
}
