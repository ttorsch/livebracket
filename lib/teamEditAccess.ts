import 'server-only';
import { cookies } from 'next/headers';
import { supabaseAdmin } from './supabaseAdmin';
import { getCurrentUser } from './auth';
import { getOrganizerForUser } from './auth';
import { readVerifiedSession, type VerifiedSession } from './verification/code';
import { normalizeRegFields, type RegField } from './registrationFields';
import type { DrawConfig } from './data';

/* ── May this person change this team? ────────────────────────────
 *
 * A team's details belong to the people on it, but a team is not an
 * account — most are registered by a visitor who never signed up. So
 * there are three ways in, and this module is the only place that knows
 * all three:
 *
 *   account   — signed in, and the team is linked to that account
 *               (`registered_by`), or the account's *verified* address is
 *               the team's contact address. The second case is the same
 *               rule claimTeamsForUser already applies at sign-in; it is
 *               repeated here so a team claimed a moment ago is editable
 *               now rather than after the next sign-in.
 *   verified  — not signed in, but held a one-time code sent to the
 *               team's own contact address within the last half hour.
 *   organizer — owns the tournament. They can already edit every team
 *               from the setup page; recognising it here means the same
 *               click works from the public page.
 *
 * What may be changed is a second question, and a narrower one. Once a
 * division's draw is locked the roster is part of the bracket's fairness
 * ceremony (see CONTEXT.md, "Draw lock") and a player swapping names into
 * seeded positions is no longer editing their details — so the roster
 * freezes and the contact details do not.
 */

/* One cookie, so one verified team at a time. A player who confirms team
 * A and then team B keeps only B — the earlier token is still alive in
 * Redis but nothing points at it any more. That is the right trade for
 * the common case (you are on one team per event) and it fails safe:
 * losing a session costs another code, never access to a team that is not
 * yours. */
export const TEAM_EDIT_COOKIE = 'lb_team_edit';

export type EditAccessVia = 'account' | 'verified' | 'organizer';

export interface TeamEditTarget {
  id: string;
  name: string;
  teamName: string | null;
  status: string;
  contactEmail: string | null;
  contactPhone: string | null;
  customFields: Record<string, unknown>;
  players: { id: string; name: string; shirtSize: string | null; customFields: Record<string, unknown>; userId: string | null }[];
  division: {
    id: string;
    name: string;
    formatTypeOnSand: string;
    maxRosterSize: unknown;
    regFields: RegField[];
    drawLocked: boolean;
  };
  tournament: { slug: string; title: string; cancelled: boolean };
}

export interface TeamEditAccess {
  team: TeamEditTarget;
  /** Null when this caller may not edit at all. */
  via: EditAccessVia | null;
  /** Frozen by the draw lock. Contact details stay editable regardless. */
  rosterLocked: boolean;
}

const TEAM_SELECT = `
  id, name, team_name, status, contact_email, contact_phone, custom_fields, registered_by,
  players(id, name, shirt_size, custom_fields, user_id),
  divisions!inner(
    id, name, format_type_on_sand, reg_fields, settings,
    tournaments!inner(slug, title, cancelled_at, deleted_at)
  )
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function shape(row: any): TeamEditTarget | null {
  const division = row.divisions;
  const tournament = division?.tournaments;
  if (!division || !tournament || tournament.deleted_at) return null;

  const settings = (division.settings ?? {}) as { maxRosterSize?: unknown; draw?: Partial<DrawConfig> | null };

  return {
    id: row.id,
    name: row.name,
    teamName: row.team_name ?? null,
    status: row.status,
    contactEmail: row.contact_email ?? null,
    contactPhone: row.contact_phone ?? null,
    customFields: (row.custom_fields ?? {}) as Record<string, unknown>,
    players: (row.players ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      shirtSize: p.shirt_size ?? null,
      customFields: (p.custom_fields ?? {}) as Record<string, unknown>,
      userId: p.user_id ?? null,
    })),
    division: {
      id: division.id,
      name: division.name,
      formatTypeOnSand: division.format_type_on_sand,
      maxRosterSize: settings.maxRosterSize,
      regFields: normalizeRegFields(division.reg_fields),
      drawLocked: Boolean(settings.draw?.isLocked),
    },
    tournament: {
      slug: tournament.slug,
      title: tournament.title,
      cancelled: Boolean(tournament.cancelled_at),
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The team as the edit flow needs it, or null if there is no such team.
 *  Says nothing about who may touch it — that is `resolveTeamEditAccess`. */
export async function loadTeamForEdit(teamId: string): Promise<{ target: TeamEditTarget; registeredBy: string | null } | null> {
  const { data, error } = await supabaseAdmin
    .from('teams')
    .select(TEAM_SELECT)
    .eq('id', teamId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load team: ${error.message}`);
  if (!data) return null;

  const target = shape(data);
  if (!target) return null;
  return { target, registeredBy: (data as { registered_by?: string | null }).registered_by ?? null };
}

/* The verified session behind this request, if it is for this team.
 *
 * `resolveTeamEditAccess` answers may-they-edit and deliberately says no
 * more. Minting an account needs two further facts that only the session
 * holds: the exact address a code was delivered to, and the channel it
 * went by. Neither can come from the team row — a contact address can
 * have changed since — and neither may ever come from the request body. */
export async function readTeamEditSession(teamId: string): Promise<VerifiedSession | null> {
  const jar = await cookies();
  const session = await readVerifiedSession(jar.get(TEAM_EDIT_COOKIE)?.value);
  if (!session || session.purpose !== 'team_edit' || session.subjectId !== teamId) return null;
  return session;
}

export async function resolveTeamEditAccess(teamId: string): Promise<TeamEditAccess | null> {
  const loaded = await loadTeamForEdit(teamId);
  if (!loaded) return null;
  const { target, registeredBy } = loaded;

  const via = await decideVia(target, registeredBy);
  return { team: target, via, rosterLocked: target.division.drawLocked };
}

async function decideVia(team: TeamEditTarget, registeredBy: string | null): Promise<EditAccessVia | null> {
  /* The cookie first: it is the cheapest check and the only one a
   * signed-out visitor can pass. */
  const jar = await cookies();
  const session = await readVerifiedSession(jar.get(TEAM_EDIT_COOKIE)?.value);
  if (session && session.purpose === 'team_edit' && session.subjectId === team.id) {
    return 'verified';
  }

  const user = await getCurrentUser();
  if (!user) return null;

  if (registeredBy && registeredBy === user.id) return 'account';

  /* An unverified address proves nothing — the same guard
   * claimTeamsForUser applies before it links anything. */
  const verified = Boolean(user.email_confirmed_at || user.confirmed_at);
  const email = user.email?.trim().toLowerCase();
  if (verified && email && team.contactEmail?.trim().toLowerCase() === email) {
    return 'account';
  }

  const organizer = await getOrganizerForUser(user.id);
  if (organizer) {
    const { data } = await supabaseAdmin
      .from('tournaments')
      .select('organizer_id')
      .eq('slug', team.tournament.slug)
      .maybeSingle();
    if (data && (data as { organizer_id: string }).organizer_id === organizer.id) return 'organizer';
  }

  return null;
}
