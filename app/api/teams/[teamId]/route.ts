import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { resolveTeamEditAccess, type TeamEditTarget } from '../../../../lib/teamEditAccess';
import { maskEmail, maskPhone } from '../../../../lib/verification/mask';
import { availableChannels } from '../../../../lib/verification/channels';
import { startContactEmailChange } from '../../../../lib/teamEditContact';
import {
  normalizeRegFields, rosterSize, minRosterNames, rosterSlotIsBlank, targetFor, isTeamField,
} from '../../../../lib/registrationFields';
import { formatPlayerNames } from '../../../../lib/teamName';

/* ── A team, as the people on it may see and change it ────────────
 *
 * The organizer's route for the same job lives under
 * /api/tournaments/[slug]/divisions/[id]/teams/[teamId] and is reached by
 * owning the tournament. This one is reached by *being* the team — see
 * lib/teamEditAccess.ts for the three ways that can be true — so it is
 * addressed by the team alone and carries no slug to guess at.
 *
 * GET answers two questions at once, because the modal asks both in the
 * same breath: may I edit this, and if not, where would a code go? The
 * second answer is masked. A visitor who can open the public page must
 * never learn a team's contact address by clicking Edit on it.
 */

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET(_request: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;

  const access = await resolveTeamEditAccess(teamId);
  if (!access) return bad('Team not found', 404);
  const { team, via, rosterLocked } = access;

  /* Which ways in this deployment could offer, paired with a hint the
   * recipient will recognise and a stranger cannot use. A channel with no
   * address stored on the team is not on the list. */
  const configured = availableChannels();
  const channels = [
    team.contactEmail && configured.includes('email')
      ? { channel: 'email' as const, hint: maskEmail(team.contactEmail) }
      : null,
    team.contactPhone && configured.includes('whatsapp')
      ? { channel: 'whatsapp' as const, hint: maskPhone(team.contactPhone) }
      : null,
  ].filter((c): c is { channel: 'email' | 'whatsapp'; hint: string } => c !== null);

  if (!via) {
    return NextResponse.json({
      canEdit: false,
      via: null,
      channels,
      /* Two different dead ends, told apart because they are not the same
       * news. A team registered with no contact address can never confirm
       * itself from the public page; a deployment with no channel switched
       * on is a configuration the visitor should not be blamed for. Both
       * end at the organizer, but only one of them is about them. */
      contactless: !team.contactEmail && !team.contactPhone,
      teamName: team.teamName,
      divisionName: team.division.name,
    });
  }

  return NextResponse.json({
    canEdit: true,
    via,
    rosterLocked,
    channels,
    team: editableTeam(team),
  });
}

const editableTeam = (team: TeamEditTarget) => ({
  id: team.id,
  teamName: team.teamName,
  status: team.status,
  contactEmail: team.contactEmail,
  contactPhone: team.contactPhone,
  customFields: team.customFields,
  players: team.players,
  division: {
    id: team.division.id,
    name: team.division.name,
    formatTypeOnSand: team.division.formatTypeOnSand,
    maxRosterSize: team.division.maxRosterSize,
    regFields: team.division.regFields,
    drawLocked: team.division.drawLocked,
  },
  tournament: team.tournament,
});

interface PlayerPatch {
  id?: string;
  name?: string;
  shirtSize?: string | null;
  custom?: Record<string, string>;
}

interface PatchBody {
  players?: PlayerPatch[];
  teamName?: string | null;
  teamCustom?: Record<string, string>;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;

  const access = await resolveTeamEditAccess(teamId);
  if (!access) return bad('Team not found', 404);
  const { team, via, rosterLocked } = access;
  if (!via) return bad('Confirm your team contact before editing', 403);
  if (team.tournament.cancelled) return bad('This tournament has been cancelled', 409);

  const body = (await request.json().catch(() => ({}))) as PatchBody;
  const fields = normalizeRegFields(team.division.regFields);

  /* ── The roster ───────────────────────────────────────────────
   * Frozen once the draw is locked, because from that moment the names
   * are seeded into a bracket. An organizer is exempt: their own route
   * has always allowed it, and they are the one who locked it. */
  const rosterGiven = Array.isArray(body.players);
  if (rosterGiven && rosterLocked && via !== 'organizer') {
    return bad('The draw is locked — ask the organizer to change the roster', 409);
  }

  const roster: { id: string; name: string; shirtSize: string | null; custom: Record<string, string> }[] = [];
  if (rosterGiven) {
    const incoming = body.players ?? [];
    const known = new Map(team.players.map((p) => [p.id, p]));

    /* Rows are matched by id and never created or destroyed here. Adding
     * a player is joining a division's roster, which is registration's
     * job and carries a cap; this route only corrects what is there. */
    for (const p of incoming) {
      if (!p.id || !known.has(p.id)) return bad('That player is not on this team', 400);
    }

    const filled = incoming.filter((p) => !rosterSlotIsBlank(p.name, Object.values(p.custom ?? {})));
    const min = minRosterNames(team.division.formatTypeOnSand);
    const max = rosterSize(team.division.formatTypeOnSand, team.division.maxRosterSize);
    if (filled.length < min || filled.length > max) {
      return bad(`A ${team.division.formatTypeOnSand} team needs between ${min} and ${max} players`);
    }

    for (const p of incoming) {
      if (!p.name?.trim()) return bad('Every player needs a name');
      for (const field of fields) {
        if (!field.required || isTeamField(field)) continue;
        const target = targetFor(field);
        const value = target === 'name' ? p.name : target === 'shirtSize' ? p.shirtSize : p.custom?.[field.id];
        if (!value?.trim()) return bad(`${field.label} is required for ${p.name.trim()}`);
      }
      roster.push({
        id: p.id!,
        name: p.name.trim(),
        shirtSize: p.shirtSize?.trim() || null,
        custom: cleanCustom(p.custom),
      });
    }
  }

  /* ── The team half ────────────────────────────────────────────*/
  const teamName = body.teamName === undefined ? undefined : body.teamName?.trim() || null;
  const contactPhone = body.contactPhone === undefined ? undefined : body.contactPhone?.trim() || null;
  const teamCustom = body.teamCustom === undefined ? undefined : cleanCustom(body.teamCustom);

  const nextEmailRaw = body.contactEmail === undefined ? undefined : body.contactEmail?.trim() || null;
  const emailChanged =
    nextEmailRaw !== undefined &&
    (nextEmailRaw ?? '').toLowerCase() !== (team.contactEmail ?? '').toLowerCase();

  for (const field of fields) {
    if (!field.required || !isTeamField(field)) continue;
    const target = targetFor(field);
    const given =
      target === 'email' ? (nextEmailRaw === undefined ? team.contactEmail : nextEmailRaw)
      : target === 'phone' ? (contactPhone === undefined ? team.contactPhone : contactPhone)
      : target === 'teamName' ? (teamName === undefined ? team.teamName : teamName)
      : (teamCustom === undefined ? team.customFields[field.id] : teamCustom[field.id]) ?? null;
    if (!given || !String(given).trim()) return bad(`${field.label} is required`);
  }

  /* A new contact address is the one change that does not take effect on
   * save. It decides who can get back in here, so it is confirmed at the
   * address being moved *to* — otherwise the last person to hold a code
   * could quietly take the team with them. Everything else in the same
   * request still saves. */
  let pendingEmail: { hint: string; sent: boolean } | null = null;
  if (emailChanged && via !== 'organizer') {
    /* Clearing it removes the only way back in, so it is refused rather
     * than silently locking a team out of its own registration. Checked
     * before the send, not after it. */
    if (nextEmailRaw === null) {
      return bad('A team needs a contact email — the organizer can clear it if you really want it gone');
    }
    if (!isPlausibleEmail(nextEmailRaw)) return bad('That email address does not look right');
    pendingEmail = await startContactEmailChange(team, nextEmailRaw);
  }

  // ── Write ───────────────────────────────────────────────────
  const teamUpdate: Record<string, unknown> = {};
  if (teamName !== undefined) teamUpdate.team_name = teamName;
  if (contactPhone !== undefined) teamUpdate.contact_phone = contactPhone;
  if (teamCustom !== undefined) teamUpdate.custom_fields = teamCustom;
  /* The organizer's own edits are not pended — they are the authority the
   * pend exists to substitute for. */
  if (emailChanged && via === 'organizer') teamUpdate.contact_email = nextEmailRaw;

  if (Object.keys(teamUpdate).length > 0) {
    const { error } = await supabaseAdmin.from('teams').update(teamUpdate).eq('id', teamId);
    if (error) return bad(error.message, 500);
  }

  for (const p of roster) {
    const update: Record<string, unknown> = { name: p.name, shirt_size: p.shirtSize };
    if (body.players?.find((b) => b.id === p.id)?.custom !== undefined) update.custom_fields = p.custom;
    const { error } = await supabaseAdmin.from('players').update(update).eq('id', p.id).eq('team_id', teamId);
    if (error) return bad(error.message, 500);
  }

  /* teams.name is the denormalised display string the brackets read. It is
   * derived from the roster, so a renamed player has to be written through
   * to it or the bracket keeps the old spelling. */
  if (roster.length > 0) {
    const { data: fresh } = await supabaseAdmin
      .from('teams').select('id, name, seed, players(id, name)').eq('id', teamId).maybeSingle();
    if (fresh) {
      const row = fresh as { name: string; seed: number | null; players: { id: string; name: string }[] };
      await supabaseAdmin
        .from('teams')
        .update({ name: formatPlayerNames(row.players, row.name, row.seed) })
        .eq('id', teamId);
    }
  }

  const after = await resolveTeamEditAccess(teamId);
  return NextResponse.json({
    ok: true,
    pendingEmail,
    team: after ? editableTeam(after.team) : null,
  });
}

const cleanCustom = (bag: Record<string, string> | undefined) =>
  Object.fromEntries(
    Object.entries(bag ?? {}).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, v.trim()]),
  );

/* Deliberately loose. The address is proved by a code arriving at it, so
 * this only catches a typo that would waste a send. */
const isPlausibleEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
