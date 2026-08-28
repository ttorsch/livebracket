/**
 * Deterministically generates a consistent 8-digit numeric Player ID
 * from a user ID (e.g. Supabase UUID).
 */
export function toPlayerId(userId: string | null | undefined): string {
  if (!userId) return '00000000';

  let hash = 2166136261;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  // Map to an 8-digit number (10000000 - 99999999)
  const num = (Math.abs(hash) % 90000000) + 10000000;
  return num.toString();
}
