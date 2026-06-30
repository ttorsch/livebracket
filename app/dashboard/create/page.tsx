import { redirect } from 'next/navigation';

// Tournament creation is now a modal launched from the dashboard.
// This route is kept only so old links don't 404 — it sends users to the dashboard.
export default function CreateRedirect() {
  redirect('/dashboard');
}
