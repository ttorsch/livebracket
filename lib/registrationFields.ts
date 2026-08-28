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
 *   core phone  → players.phone
 *   core email  → players.email
 *   apparel     → players.shirt_size
 *   everything else → players.custom_fields, keyed by field id
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
