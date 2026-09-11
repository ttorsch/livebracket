/* ── The registration form an organizer builds ────────────────────
 *
 * Each division owns its own form. `divisions.reg_fields` is an ordered
 * list of questions asked of every player on the roster: three
 * non-deletable core fields, any of four quick-add presets, and whatever
 * else the organizer wrote themselves.
 *
 * The setup page authors that list and the public registration page
 * renders it, so the shape — and the rule mapping a question onto a
 * column — lives here rather than in either of them. A rule written
 * twice is a rule that drifts.
 *
 * Where an answer is stored is decided by what the question *is*, not by
 * its position in the list:
 *
 *   core text   → players.name
 *   core phone  → teams.contact_phone
 *   core email  → teams.contact_email
 *   apparel     → players.shirt_size
 *   everything else → players.custom_fields, keyed by field id
 *
 * The two core contact questions are answered once for the whole team, not
 * once per player: that is how the form asks them and how an organizer
 * reaches an entry. They used to be copied onto every player row, which
 * stored one fact N times and let the copies drift apart.
 *
 * Core fields are matched by type rather than by id because the ids
 * ('base-player', …) are only what the setup page happens to mint; a
 * division saved before those settled still has to map correctly.
 */

export type RegFieldType = 'text' | 'phone' | 'email' | 'paragraph' | 'select';
export type PresetKey = 'apparel' | 'skill' | 'hometown' | 'nationality';

export interface RegField {
  id: string;
  label: string;
  type: RegFieldType;
  options?: string[];
  required: boolean;
  core?: boolean;       // part of the non-deletable Base Form block
  preset?: PresetKey;   // appended by a Quick-Add toggle chip
}

/** Which player column an answer lands in. 'custom' means the jsonb bag. */
export type RegFieldTarget = 'name' | 'phone' | 'email' | 'shirtSize' | 'custom';

export function targetFor(field: RegField): RegFieldTarget {
  if (field.core) {
    if (field.type === 'phone') return 'phone';
    if (field.type === 'email') return 'email';
    return 'name';
  }
  if (field.preset === 'apparel') return 'shirtSize';
  return 'custom';
}

/** The three core questions, injected into every new division. Kept here so
 *  a division whose reg_fields never got saved still renders a usable form. */
export const BASE_REG_FIELDS: RegField[] = [
  { id: 'base-player', label: "Player's Name", type: 'text', required: true, core: true },
  { id: 'base-phone', label: "Player's Phone Number", type: 'phone', required: true, core: true },
  { id: 'base-email', label: 'Captain Email', type: 'email', required: true, core: true },
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

/** The team-level half: one contact pair per entry. */
export interface StoredTeamContact {
  contactEmail?: string | null;
  contactPhone?: string | null;
}

/** True for the two core questions the team answers once. Everything else —
 *  including a phone or email the organizer wrote as a *custom* question,
 *  which targets the jsonb bag — belongs to a player. */
export function isTeamContactField(field: RegField): boolean {
  const target = targetFor(field);
  return target === 'phone' || target === 'email';
}

/** The answer this question holds for this player, or '' if unanswered.
 *  Contact is not a player's to give: read it with contactAnswerFor. */
export function answerFor(field: RegField, player: StoredPlayerAnswers): string {
  switch (targetFor(field)) {
    case 'name': return player.name?.trim() ?? '';
    case 'shirtSize': return player.shirtSize?.trim() ?? '';
    case 'phone':
    case 'email': return '';
    case 'custom': {
      const value = player.customFields?.[field.id];
      return typeof value === 'string' ? value.trim() : '';
    }
  }
}

/** The answer a core contact question holds for this team. */
export function contactAnswerFor(field: RegField, team: StoredTeamContact): string {
  switch (targetFor(field)) {
    case 'phone': return team.contactPhone?.trim() ?? '';
    case 'email': return team.contactEmail?.trim() ?? '';
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
