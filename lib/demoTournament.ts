/* ── Is this a real event, or demo scaffolding? ───────────────────
 *
 * The try-it-yourself demo clones the golden template tournaments into a
 * throwaway sandbox per visitor, and the templates themselves are rows in
 * the same table. Neither is an event anyone is playing, so nothing public
 * — the tournament list, the homepage hero and its counts, an organizer's
 * card — should show or count them.
 *
 * Migration 0019 adds `sandbox_id` and `is_template` for exactly this, but
 * it has not been applied everywhere, so they are optional and checked
 * anyway. Today the slugs are what actually does the work: templates end
 * in `-template`, and sandbox clones are `andaman-masters-<id>` and
 * `khao-lak-open-<id>`.
 *
 * Pure and import-free, so client code, API routes and server-only
 * modules can all share the one rule. */

export interface DemoCheckable {
  slug?: string | null;
  is_template?: boolean | null;
  sandbox_id?: string | null;
}

export function isDemoTournament(t: DemoCheckable): boolean {
  if (t.is_template) return true;
  if (t.sandbox_id) return true;
  const slug = t.slug ?? '';
  if (!slug) return false;
  if (slug.endsWith('-template')) return true;
  return slug.startsWith('andaman-masters-') || slug.startsWith('khao-lak-open-');
}
