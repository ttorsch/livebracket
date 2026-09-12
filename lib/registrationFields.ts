/* ── The registration form an organizer builds ────────────────────
 *
 * Each division owns its own form. `divisions.reg_fields` is an ordered
 * list of questions, and every question belongs to one of two halves:
 *
 *   Team info   — asked once for the whole entry
 *   Player info — asked of each player on the roster
 *
 * The setup page authors that list and the public registration page
 * renders it, so the shape — and the rule mapping a question onto a
 * column — lives here rather than in either of them. A rule written
 * twice is a rule that drifts.
 *
 * Where an answer is stored is decided by what the question *is*, not by
 * its position in the list:
 *
 *   core text      → players.name
 *   core phone     → teams.contact_phone
 *   core email     → teams.contact_email
 *   teamName       → teams.team_name
 *   apparel        → players.shirt_size
 *   other team question   → teams.custom_fields, keyed by field id
 *   other player question → players.custom_fields, keyed by field id
 *
 * Scope is fixed for everything the platform names and chosen for
 * everything the organizer writes:
 *
 *   core contact, teamName        always team
 *   apparel, skill, hometown,
 *     nationality, core name      always player
 *   custom question               field.scope, defaulting to player
 *
 * The default matters: every custom question written before scope existed
 * was a per-player one, so an absent scope has to keep meaning that.
 *
 * Core fields are matched by type rather than by id because the ids
 * ('base-player', …) are only what the setup page happens to mint; a
 * division saved before those settled still has to map correctly.
 */

export type RegFieldType = 'text' | 'phone' | 'email' | 'paragraph' | 'select';

/* Per-player quick-adds. `teamName` is deliberately not one of them — it is
   offered in the team half and lands in its own column. */
export type PresetKey = 'apparel' | 'skill' | 'hometown' | 'nationality';
export type TeamPresetKey = 'teamName';

/** Which half of the form a question belongs to. */
export type RegFieldScope = 'team' | 'player';

export interface RegField {
  id: string;
  label: string;
  type: RegFieldType;
  options?: string[];
  required: boolean;
  core?: boolean;              // part of the non-deletable Base Form block
  preset?: PresetKey;          // appended by a per-player Quick-Add chip
  teamPreset?: TeamPresetKey;  // appended by a Team info Quick-Add chip
  /* Only read for a question the organizer wrote; everything else has a
     scope the platform fixes. Absent means per-player. */
  scope?: RegFieldScope;
}

/** Which column an answer lands in. 'custom' means a jsonb bag — which of
 *  the two is decided by scopeFor, not by this. */
export type RegFieldTarget = 'name' | 'phone' | 'email' | 'teamName' | 'shirtSize' | 'custom';

export function targetFor(field: RegField): RegFieldTarget {
  if (field.core) {
    if (field.type === 'phone') return 'phone';
    if (field.type === 'email') return 'email';
    return 'name';
  }
  if (field.teamPreset === 'teamName') return 'teamName';
  if (field.preset === 'apparel') return 'shirtSize';
  return 'custom';
}

/** Which half of the form this question is asked in. */
export function scopeFor(field: RegField): RegFieldScope {
  switch (targetFor(field)) {
    case 'phone':
    case 'email':
    case 'teamName':
      return 'team';
    case 'name':
    case 'shirtSize':
      return 'player';
    case 'custom':
      // A preset the platform defines is per-player by definition; only the
      // organizer's own questions carry a choice.
      return field.preset ? 'player' : field.scope === 'team' ? 'team' : 'player';
  }
}

export const isTeamField = (field: RegField) => scopeFor(field) === 'team';
export const isPlayerField = (field: RegField) => scopeFor(field) === 'player';

/** The three core questions, injected into every new division. Kept here so
 *  a division whose reg_fields never got saved still renders a usable form. */
export const BASE_REG_FIELDS: RegField[] = [
  { id: 'base-player', label: "Player's Name", type: 'text', required: true, core: true },
  { id: 'base-phone', label: 'Team contact no.', type: 'phone', required: true, core: true },
  { id: 'base-email', label: 'Team email', type: 'email', required: true, core: true },
];

const FIELD_TYPES: RegFieldType[] = ['text', 'phone', 'email', 'paragraph', 'select'];

/** Read a division's reg_fields jsonb back into typed fields, dropping
 *  anything malformed. Falls back to the base form for a division that has
 *  none — an empty roster step would leave a player with nowhere to register. */
export function normalizeRegFields(raw: unknown): RegField[] {
  if (!Array.isArray(raw)) return BASE_REG_FIELDS;

  const fields = raw.flatMap((entry): RegField[] => {
    if (!entry || typeof entry !== 'object') return [];
    const f = entry as Record<string, unknown>;
    if (typeof f.id !== 'string' || !f.id) return [];
    const type = FIELD_TYPES.includes(f.type as RegFieldType) ? (f.type as RegFieldType) : 'text';
    const options = Array.isArray(f.options) ? f.options.filter((o): o is string => typeof o === 'string') : undefined;
    return [{
      id: f.id,
      label: typeof f.label === 'string' && f.label.trim() ? f.label : f.id,
      type,
      // A select with no options can't be answered; render it as free text.
      ...(type === 'select' && options?.length ? { options } : type === 'select' ? { type: 'text' as const } : {}),
      required: f.required === true,
      ...(f.core === true ? { core: true as const } : {}),
      ...(typeof f.preset === 'string' ? { preset: f.preset as PresetKey } : {}),
      ...(f.teamPreset === 'teamName' ? { teamPreset: 'teamName' as const } : {}),
      ...(f.scope === 'team' || f.scope === 'player' ? { scope: f.scope as RegFieldScope } : {}),
    }];
  });

  return fields.length ? fields : BASE_REG_FIELDS;
}

/** Players on the sand per format → also the minimum legal roster size. */
export const FORMAT_PLAYERS: Record<string, number> = { '2v2': 2, '3v3': 3, '4v4': 4, '6v6': 6 };

/** How many players the roster form asks for. The organizer's maxRosterSize
 *  allows alternates above the format minimum; anything smaller than the
 *  format itself can't field a team, so the format wins. */
export function rosterSize(format: string, maxRosterSize: unknown): number {
  const min = FORMAT_PLAYERS[format] ?? 2;
  const max = typeof maxRosterSize === 'number' && Number.isFinite(maxRosterSize) ? Math.trunc(maxRosterSize) : min;
  return Math.max(min, Math.min(max, 12));
}

/** How many names a team actually has to give: the players it puts on the
 *  sand. rosterSize is how many slots the form *offers* — the difference is
 *  alternates, which a team may carry but cannot be made to name. A 4v4
 *  division with a roster of 6 needs four names, not six. */
export function minRosterNames(format: string): number {
  return FORMAT_PLAYERS[format] ?? 2;
}

/** Whether a roster slot was left alone, and so can be dropped rather than
 *  rejected for having no name.
 *
 *  Apparel is deliberately not among the answers callers pass in: the form
 *  pre-selects a size, so every untouched slot carries one and would look
 *  answered. Name and the division's own questions are what a person has
 *  to have typed. */
export function rosterSlotIsBlank(
  name: string | null | undefined,
  answers: (string | null | undefined)[],
): boolean {
  if (name?.trim()) return false;
  return !answers.some(answer => answer?.trim());
}

/* The skill ladder offered by the Skill Level preset.
 *
 * Fixed rather than organizer-editable: the presets exist so a division
 * can add a common question without inventing one, and a shared ladder is
 * the point — two events that both ask for "skill level" should mean the
 * same thing by it. An organizer who wants their own wording adds a
 * custom question instead. */
export const SKILL_LEVELS = [
  'Beginner',
  'Intermediate',
  'Advanced',
  'Professional',
  'Olympic medal',
] as const;

/* ── Reading a stored answer back ─────────────────────────────────
 *
 * `targetFor` says where an answer is written; these say how to read it
 * back out and what control it was answered with.
 *
 * The organizer's team views need this because they show the division's
 * own questions rather than a fixed four. A division that never asked
 * for a shirt size should not be shown one — and, worse, should never
 * have one written for it, which is what a hardcoded control did.
 *
 * Structural on purpose: RegisteredPlayerRow and the edit form's own
 * draft both satisfy it without either having to import the other.
 */
export interface StoredPlayerAnswers {
  name?: string | null;
  shirtSize?: string | null;
  customFields?: Record<string, unknown> | null;
}

/** The team-level half of an entry's answers. */
export interface StoredTeamAnswers {
  contactEmail?: string | null;
  contactPhone?: string | null;
  teamName?: string | null;
  customFields?: Record<string, unknown> | null;
}

/** The answer this question holds for this player, or '' if unanswered.
 *  A team question is not a player's to give: read it with teamAnswerFor. */
export function answerFor(field: RegField, player: StoredPlayerAnswers): string {
  if (isTeamField(field)) return '';
  switch (targetFor(field)) {
    case 'name': return player.name?.trim() ?? '';
    case 'shirtSize': return player.shirtSize?.trim() ?? '';
    case 'custom': {
      const value = player.customFields?.[field.id];
      return typeof value === 'string' ? value.trim() : '';
    }
    default: return '';
  }
}

/** The answer a team question holds for this entry, or '' if unanswered. */
export function teamAnswerFor(field: RegField, team: StoredTeamAnswers): string {
  switch (targetFor(field)) {
    case 'phone': return team.contactPhone?.trim() ?? '';
    case 'email': return team.contactEmail?.trim() ?? '';
    case 'teamName': return team.teamName?.trim() ?? '';
    case 'custom': {
      if (!isTeamField(field)) return '';
      const value = team.customFields?.[field.id];
      return typeof value === 'string' ? value.trim() : '';
    }
    default: return '';
  }
}

/** Where a division offers no apparel list of its own. */
export const DEFAULT_APPAREL_SIZES = ['S', 'M', 'L', 'XL'];

/** The choices a question offers, with the preset ladders standing in
 *  where the organizer left the list empty. `[]` for a question that is
 *  not a choice at all — which is also the test for "render an input". */
export function optionsFor(field: RegField): string[] {
  if (field.options?.length) return field.options;
  if (field.preset === 'apparel') return [...DEFAULT_APPAREL_SIZES];
  if (field.preset === 'skill') return [...SKILL_LEVELS];
  return [];
}

/** How an answer reads in the one-line summary under a player's name.
 *  Apparel is the one preset whose value says nothing alone: "L" is
 *  noise, "Size L" is the answer. */
export function summaryAnswerFor(field: RegField, player: StoredPlayerAnswers): string {
  const value = answerFor(field, player);
  if (!value) return '';
  return field.preset === 'apparel' ? `Size ${value}` : value;
}
