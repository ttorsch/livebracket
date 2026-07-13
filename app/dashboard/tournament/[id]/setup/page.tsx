'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { 
  Check, 
  ChevronRight, 
  Plus, 
  Trash2, 
  Settings, 
  Pencil,
  Globe, 
  Lock, 
  Calendar, 
  BookOpen, 
  Info, 
  Sparkles, 
  Gift, 
  ListPlus,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Trash,
  Clock,
  Layers,
  Award,
  ChevronDown,
  ImagePlus,
  X,
  MapPin,
  Eye,
  UploadCloud
} from 'lucide-react';
import styles from './page.module.css';
import { getTournamentBasicInfo, type TournamentBasicInfo, getSetupDivisions, type SetupDivisionRow } from '../../../../../lib/data';

interface Question {
  id: string;
  label: string;
  type: 'text' | 'select' | 'checkbox';
  options?: string[];
  required: boolean;
}

interface Voucher {
  id: string;
  title: string;
  description: string;
  code: string;
  visibility: 'public' | 'player';
}

interface Team {
  id: string;
  name: string;
  phone: string;
  email: string;
  seed: number;
  paymentCleared: boolean;
  registeredAt: Date;
  status: 'confirmed' | 'unpaid' | 'waitlist';
}

// ── Per-division registration schema types ───────────────────────
type RegFieldType = 'text' | 'phone' | 'email' | 'paragraph' | 'select';
type PresetKey = 'apparel' | 'skill' | 'hometown' | 'nationality';

interface RegField {
  id: string;
  label: string;
  type: RegFieldType;
  options?: string[];
  required: boolean;
  core?: boolean;       // part of the non-deletable Base Form block
  preset?: PresetKey;   // appended by a Quick-Add toggle chip
}

type OnSandFormat = '2v2' | '3v3' | '4v4' | '6v6';
type RoundFormat = 'pool' | 'round-robin' | 'single' | 'double';

interface TournamentRound {
  id: string;
  format: RoundFormat | null; // null until the organizer picks one
  scoring: ScoringRules;      // each round can have its own scoring (e.g. pool play to 21, single elim best of 3)
}

const ROUND_FORMATS: { value: RoundFormat; label: string }[] = [
  { value: 'pool', label: 'Pool Play' },
  { value: 'round-robin', label: 'Round Robin' },
  { value: 'single', label: 'Single Elimination' },
  { value: 'double', label: 'Double Elimination' },
];

const roundLabel = (i: number) => {
  const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];
  return ordinals[i] ? `${ordinals[i]} Round` : `Round ${i + 1}`;
};

interface ScoringRules {
  setsBestOf: number;        // best of 1 / 3 / 5
  pointsPerSet: number;      // Sets 1 & 2 target
  winBy2: boolean;           // must win by two
  hardCap: number;           // hard cap ceiling (0 = none)
  decidingSetPoints: number; // deciding (final) set target
}

interface SetupDivision {
  id: string;
  name: string;
  // A. Basics & dynamic capacity
  divisionTeamCap: number;          // flips public button to "Waitlist Full"
  formatTypeOnSand: OnSandFormat;   // dictates the scoring engine
  maxRosterSize: number;            // defaults to format, allows alternates
  // B. Staggered timing & fees
  registrationFee: number;          // flat per-team-slot, can be 0
  registrationOpenDate: string;     // datetime-local string, staggered windows
  // C. Rules & formats
  rounds: TournamentRound[];        // ordered tournament rounds, each with its own format + scoring
  rules: string;
  // Per-division (isolated) registration schema
  regFields: RegField[];
  // Advanced options (recommended)
  allowMulti: boolean;
  genderEligibility: string;
  prizePool: string;
  netHeight: string;
  minTeams: number;
  waitlistCap: number;
  // Post-registration response (shown after a player successfully registers)
  confirmationMessage: string;
  confirmationImage: string; // data URL or '' — e.g. WhatsApp QR / flyer
}

// Players on the sand per format → also the minimum legal roster size.
const FORMAT_PLAYERS: Record<OnSandFormat, number> = { '2v2': 2, '3v3': 3, '4v4': 4, '6v6': 6 };

// The Base Form block: four mandatory core inputs, injected into every new
// division and non-deletable.
const makeBaseFields = (): RegField[] => [
  { id: 'base-player', label: "Player's Name", type: 'text', required: true, core: true },
  { id: 'base-phone', label: "Player's Phone Number", type: 'phone', required: true, core: true },
  { id: 'base-email', label: 'Captain Email', type: 'email', required: true, core: true },
];

// Quick-Add presets: one-click toggle chips that append standard fields.
const PRESETS: { key: PresetKey; label: string; build: () => RegField }[] = [
  {
    key: 'apparel',
    label: 'Apparel Size',
    build: () => ({ id: 'preset-apparel', label: 'Apparel Size', type: 'select', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'], required: false, preset: 'apparel' }),
  },
  {
    key: 'skill',
    label: 'Skill Level',
    build: () => ({ id: 'preset-skill', label: 'Skill Level', type: 'select', options: ['Novice', 'Intermediate', 'Advanced', 'Open'], required: false, preset: 'skill' }),
  },
  {
    key: 'hometown',
    label: 'Home Town / Club',
    build: () => ({ id: 'preset-hometown', label: 'Home Town / Club', type: 'text', required: false, preset: 'hometown' }),
  },
  {
    key: 'nationality',
    label: 'Nationality',
    build: () => ({ id: 'preset-nationality', label: 'Nationality', type: 'text', required: false, preset: 'nationality' }),
  },
];

const defaultScoringRules = (): ScoringRules => ({
  setsBestOf: 3,
  pointsPerSet: 21,
  winBy2: true,
  hardCap: 0,
  decidingSetPoints: 15,
});

// Map a division row loaded from the database (lib/data.ts) into the shape
// this page works with, filling in defaults for any settings jsonb keys
// that predate a given field (or were never set by the organizer).
const mapDbDivision = (row: SetupDivisionRow): SetupDivision => {
  const settings = row.settings ?? {};
  const formatTypeOnSand = row.formatTypeOnSand as OnSandFormat;
  return {
    id: row.id,
    name: row.name,
    divisionTeamCap: row.divisionTeamCap,
    formatTypeOnSand,
    maxRosterSize: typeof settings.maxRosterSize === 'number' ? settings.maxRosterSize : FORMAT_PLAYERS[formatTypeOnSand] ?? 2,
    registrationFee: row.registrationFee,
    registrationOpenDate: typeof settings.registrationOpenDate === 'string' ? settings.registrationOpenDate : '',
    rounds: row.rounds.map((r) => ({
      id: r.id,
      format: r.format as RoundFormat,
      scoring: (r.scoringRules as unknown as ScoringRules) && Object.keys(r.scoringRules).length
        ? (r.scoringRules as unknown as ScoringRules)
        : defaultScoringRules(),
    })),
    rules: typeof settings.rules === 'string' ? settings.rules : 'Standard FIVB Beach Volleyball rules apply.',
    regFields: (row.regFields as RegField[]) ?? makeBaseFields(),
    allowMulti: typeof settings.allowMulti === 'boolean' ? settings.allowMulti : true,
    genderEligibility: typeof settings.genderEligibility === 'string' ? settings.genderEligibility : 'Open',
    prizePool: typeof settings.prizePool === 'string' ? settings.prizePool : '',
    netHeight: typeof settings.netHeight === 'string' ? settings.netHeight : '2.24m',
    minTeams: typeof settings.minTeams === 'number' ? settings.minTeams : 4,
    waitlistCap: typeof settings.waitlistCap === 'number' ? settings.waitlistCap : 5,
    confirmationMessage: typeof settings.confirmationMessage === 'string' ? settings.confirmationMessage : '',
    confirmationImage: typeof settings.confirmationImage === 'string' ? settings.confirmationImage : '',
  };
};

// Create Division modal is split into three navigable steps.
const MODAL_STEPS = ['Basics & Fee', 'Format & Rules', 'Registration'];

// Format the tournament date range collected on the create form (YYYY-MM-DD).
const formatDateRange = (start?: string, end?: string): string => {
  if (!start) return '';
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  const s = new Date(`${start}T00:00`).toLocaleDateString(undefined, opts);
  if (end && end !== start) {
    const e = new Date(`${end}T00:00`).toLocaleDateString(undefined, opts);
    return `${s} – ${e}`;
  }
  return s;
};

export default function OrganizerSetup() {
  const params = useParams();

  // Active Map Phase: 1 = Initial Shell, 2 = Rules Announced, 3 = Live Reg, 4 = Logistics (Day Before)
  const [activePhase, setActivePhase] = useState<1 | 2 | 3 | 4>(1);

  // Info carried over from the create form (when arriving on a freshly created draft).
  const [tournamentInfo, setTournamentInfo] = useState<{
    title: string;
    location?: string;
    startDate?: string;
    endDate?: string;
    regOpenDate?: string;
  } | null>(null);

  // Real tournament basic info from the database (title, location, dates, description).
  // Present once the tournament has actually been published (has a DB row).
  const [basicInfo, setBasicInfo] = useState<TournamentBasicInfo | null>(null);
  const [showBasicInfoEdit, setShowBasicInfoEdit] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editIsOneDay, setEditIsOneDay] = useState(false);
  const [editDescription, setEditDescription] = useState('');
  const [basicInfoSaving, setBasicInfoSaving] = useState(false);
  const [basicInfoError, setBasicInfoError] = useState('');
  
  const [posterHover, setPosterHover] = useState(false);
  const [showPosterModal, setShowPosterModal] = useState(false);
  const [tempPoster, setTempPoster] = useState('');

  const handlePosterUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setTempPoster(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(file);
  };

  const savePoster = () => {
    if (basicInfo) {
      setBasicInfo({ ...basicInfo, imageUrl: tempPoster });
    }
    setShowPosterModal(false);
  };

  // Phase 1 States: Division Modal & List
  const [showModal, setShowModal] = useState(false);
  const [modalStep, setModalStep] = useState(0); // 0 = Basics & Fee, 1 = Format & Rules, 2 = Registration
  // Populated from the database once the tournament (and its divisions, if
  // any) load — see the mount effect below. Starts empty rather than seeded
  // with sample data, so a freshly published tournament with no divisions
  // shows none, instead of a leftover mock division.
  const [divisions, setDivisions] = useState<SetupDivision[]>([]);
  const [divisionsLoading, setDivisionsLoading] = useState(true);
  const [divisionSaving, setDivisionSaving] = useState(false);

  // Which division is currently selected in the top toggle, and which (if any)
  // the modal is editing (null = creating a new division).
  const [activeDivisionId, setActiveDivisionId] = useState<string | null>(null);
  const [editingDivisionId, setEditingDivisionId] = useState<string | null>(null);

  // Modal Form Inputs — A. Basics & dynamic capacity
  const [divName, setDivName] = useState('');
  const [divCap, setDivCap] = useState(8);
  const [formatType, setFormatType] = useState<OnSandFormat>('2v2');
  const [maxRoster, setMaxRoster] = useState(2);
  // B. Staggered timing & fees
  const [regFee, setRegFee] = useState(800);
  const [regOpenDate, setRegOpenDate] = useState('');
  const [isOpenImmediately, setIsOpenImmediately] = useState(true);
  // C. Rules & formats — each round carries its own scoring rules (a pool
  // play round might go to 21 points while the elimination round after it
  // is best of 3), so scoring lives on TournamentRound, not the division.
  const [rounds, setRounds] = useState<TournamentRound[]>([{ id: 'r_1', format: null, scoring: defaultScoringRules() }]);
  const [divRules, setDivRules] = useState('Standard FIVB Beach Volleyball rules apply.');

  // Per-division registration schema (isolated to this division)
  const [regFields, setRegFields] = useState<RegField[]>(makeBaseFields());

  // Post-registration response (confirmation message + optional photo)
  const [confirmationMessage, setConfirmationMessage] = useState('');
  const [confirmationImage, setConfirmationImage] = useState('');

  // Validation
  const [formError, setFormError] = useState<string | null>(null);

  // Recommended/Missing Fields Inputs (Advanced Options)
  const [allowMulti, setAllowMulti] = useState(true);
  const [genderEligibility, setGenderEligibility] = useState('Women');
  const [prizePool, setPrizePool] = useState('');
  const [netHeight, setNetHeight] = useState('2.24m');
  const [minTeams, setMinTeams] = useState(4);
  const [waitlistCap, setWaitlistCap] = useState(5);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Phase 2 States
  const [questionsLocked, setQuestionsLocked] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([
    { id: '1', label: 'T-shirt/Singlet Size', type: 'select', options: ['S', 'M', 'L', 'XL'], required: true },
    { id: '2', label: 'Team Fun Fact (for commentators)', type: 'text', required: false },
  ]);
  const [newQuestionLabel, setNewQuestionLabel] = useState('');
  const [newQuestionType, setNewQuestionType] = useState<'text' | 'select' | 'checkbox'>('text');
  const [newQuestionOptions, setNewQuestionOptions] = useState('');

  // Phase 3 States: Registration & 24h Clock Simulator
  const [teams, setTeams] = useState<Team[]>([
    { id: 't1', name: 'Santos / Lima', phone: '0812345678', email: 'santos@beach.com', seed: 1, paymentCleared: true, registeredAt: new Date(Date.now() - 3600000 * 4), status: 'confirmed' },
    { id: 't2', name: 'Kramer / de Vries', phone: '0898765432', email: 'kramer@beach.com', seed: 2, paymentCleared: true, registeredAt: new Date(Date.now() - 3600000 * 2), status: 'confirmed' },
    { id: 't3', name: 'Charoenwong / Rattanawong', phone: '0855551234', email: 'c@beach.com', seed: 3, paymentCleared: false, registeredAt: new Date(Date.now() - 3600000 * 25), status: 'unpaid' }, // Expired (>24h)
    { id: 't4', name: 'Müller / Schmidt', phone: '0877778888', email: 'muller@beach.com', seed: 4, paymentCleared: false, registeredAt: new Date(), status: 'unpaid' },
  ]);
  const [waitlist, setWaitlist] = useState<Team[]>([
    { id: 'wl1', name: 'Tanaka / Yamamoto', phone: '0833334444', email: 'tanaka@beach.com', seed: 5, paymentCleared: false, registeredAt: new Date(), status: 'waitlist' },
  ]);
  const [regTeamName, setRegTeamName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regError, setRegError] = useState<string | null>(null);

  // Phase 4 States: Logistics
  const [courts, setCourts] = useState<string[]>(['Center Court', 'Court 2']);
  const [newCourtName, setNewCourtName] = useState('');
  const [poolA, setPoolA] = useState<Team[]>([]);
  const [poolB, setPoolB] = useState<Team[]>([]);
  const [scheduleGenerated, setScheduleGenerated] = useState(false);

  // Module 2 & 3 States
  const [vouchers, setVouchers] = useState<Voucher[]>([
    { id: 'v1', title: '20% off Pak Weep Hotel Rooms', description: 'Available for all visitors browsing the event page.', code: 'PAK20', visibility: 'public' },
    { id: 'v2', title: 'Free Electrolyte Drink at Court Check-in', description: 'Exclusive voucher shown on player confirmation pass.', code: 'PLAYERFUEL', visibility: 'player' }
  ]);
  const [newVoucherTitle, setNewVoucherTitle] = useState('');
  const [newVoucherDesc, setNewVoucherDesc] = useState('');
  const [newVoucherCode, setNewVoucherCode] = useState('');
  const [newVoucherVis, setNewVoucherVis] = useState<'public' | 'player'>('public');

  // Floating back button: hides on scroll down, reappears on scroll up.
  const [backHidden, setBackHidden] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y > lastY && y > 80) setBackHidden(true);
      else if (y < lastY) setBackHidden(false);
      lastY = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const [rules, setRules] = useState('Standard FIVB Beach Volleyball rules apply. Matches are best of 3 sets to 21 points (third set to 15 if needed). Warm-ups are strictly limited to 5 minutes.');
  const [venueInfo, setVenueInfo] = useState('Memories Beach, Khao Lak. Food and drinks are available at the beach club. Free parking is available for players.');

  // Modal open reset
  const handleOpenCreateModal = () => {
    setEditingDivisionId(null);
    setDivName('');
    setDivCap(8);
    setFormatType('2v2');
    setMaxRoster(FORMAT_PLAYERS['2v2']);
    setRegFee(800);
    setRegOpenDate('');
    setIsOpenImmediately(true);
    setRounds([{ id: 'r_' + Date.now(), format: null, scoring: defaultScoringRules() }]);
    setDivRules('Standard FIVB Beach Volleyball rules apply.');
    setRegFields(makeBaseFields());
    setConfirmationMessage('');
    setConfirmationImage('');
    setFormError(null);
    setAllowMulti(true);
    setGenderEligibility('Women');
    setPrizePool('');
    setNetHeight('2.24m');
    setMinTeams(4);
    setWaitlistCap(5);
    setShowAdvanced(false);
    setModalStep(0);
    setShowModal(true);
  };

  // Open the modal pre-filled with an existing division to edit it.
  const handleEditDivision = (id: string) => {
    const d = divisions.find(x => x.id === id);
    if (!d) return;
    setEditingDivisionId(id);
    setDivName(d.name);
    setDivCap(d.divisionTeamCap);
    setFormatType(d.formatTypeOnSand);
    setMaxRoster(d.maxRosterSize);
    setRegFee(d.registrationFee);
    setRegOpenDate(d.registrationOpenDate);
    setIsOpenImmediately(!d.registrationOpenDate);
    setRounds(d.rounds.length ? d.rounds : [{ id: 'r_' + Date.now(), format: null, scoring: defaultScoringRules() }]);
    setDivRules(d.rules);
    setRegFields(d.regFields);
    setConfirmationMessage(d.confirmationMessage);
    setConfirmationImage(d.confirmationImage);
    setAllowMulti(d.allowMulti);
    setGenderEligibility(d.genderEligibility);
    setPrizePool(d.prizePool);
    setNetHeight(d.netHeight);
    setMinTeams(d.minTeams);
    setWaitlistCap(d.waitlistCap);
    setFormError(null);
    setShowAdvanced(false);
    setModalStep(0);
    setShowModal(true);
  };

  // Per-step validation for the Create Division wizard.
  const validateModalStep = (s: number): string | null => {
    if (s === 0) {
      if (!divName.trim()) return 'Division name is required.';
      if (maxRoster < FORMAT_PLAYERS[formatType]) {
        return `Max Roster Size must be at least ${FORMAT_PLAYERS[formatType]} to field a ${formatType} team.`;
      }
    }
    if (s === 1) {
      if (rounds.some(r => r.format === null)) return 'Choose a format for every round.';
    }
    if (s === 2) {
      if (regFields.some(f => !f.core && !f.label.trim())) return 'Every custom registration question needs a label.';
    }
    return null;
  };

  // Navigate to a step. Going forward validates every step in between.
  const goToModalStep = (target: number) => {
    if (target > modalStep) {
      for (let i = modalStep; i < target; i++) {
        const err = validateModalStep(i);
        if (err) { setFormError(err); setModalStep(i); return; }
      }
    }
    setFormError(null);
    setModalStep(target);
  };

  const handleModalNext = () => goToModalStep(modalStep + 1);
  const handleModalBack = () => { setFormError(null); setModalStep(Math.max(0, modalStep - 1)); };

  // Read an uploaded confirmation photo as a data URL (no backend — stored inline).
  const handleConfirmationImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setConfirmationImage(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(file);
  };

  // On arrival from the create form: load the carried draft info and, for a brand-new
  // tournament (?new=1), start with an empty division list and auto-open the Create
  // Division modal. The tournament stays at Phase 1 (Draft) — nothing is published.
  useEffect(() => {
    const id = Array.isArray(params.id) ? params.id[0] : params.id;
    if (!id) return;

    let draft: { title: string; location?: string; startDate?: string; endDate?: string; regOpenDate?: string } | null = null;
    try {
      const raw = sessionStorage.getItem(`lb:draft:${id}`);
      if (raw) draft = JSON.parse(raw);
    } catch {
      draft = null;
    }
    if (draft) {
      setTournamentInfo(draft);
      setDivisions([]);
      setActiveDivisionId(null);
    }

    const isNew = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('new');
    if (isNew) {
      handleOpenCreateModal();
      if (draft?.regOpenDate) {
        setRegOpenDate(draft.regOpenDate);
        setIsOpenImmediately(false);
      }
    }

    getTournamentBasicInfo(id).then(info => {
      if (info) setBasicInfo(info);
    }).catch(console.error);

    // Real divisions for this tournament, if it's been published — an
    // unpublished draft (no DB row yet) simply resolves to an empty list,
    // which is also the correct state for a published tournament that
    // hasn't had any divisions added yet.
    getSetupDivisions(id)
      .then(rows => {
        const mapped = rows.map(mapDbDivision);
        setDivisions(mapped);
        setActiveDivisionId(prev => prev ?? mapped[0]?.id ?? null);
      })
      .catch(console.error)
      .finally(() => setDivisionsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openBasicInfoEdit = () => {
    if (basicInfo) {
      setEditTitle(basicInfo.title);
      setEditLocation(basicInfo.location);
      setEditStartDate(basicInfo.startDate);
      setEditEndDate(basicInfo.endDate ?? basicInfo.startDate);
      setEditIsOneDay(basicInfo.isOneDay);
      setEditDescription(basicInfo.description ?? '');
    } else {
      setEditTitle(tournamentInfo?.title ?? '');
      setEditLocation(tournamentInfo?.location ?? '');
      setEditStartDate(tournamentInfo?.startDate ?? '');
      setEditEndDate(tournamentInfo?.endDate ?? tournamentInfo?.startDate ?? '');
      setEditIsOneDay(false);
      setEditDescription('');
    }
    setBasicInfoError('');
    setShowBasicInfoEdit(true);
  };

  const saveBasicInfo = async () => {
    if (!editTitle.trim() || !editLocation.trim() || !editStartDate) {
      setBasicInfoError('Title, location, and start date are required.');
      return;
    }
    const id = Array.isArray(params.id) ? params.id[0] : params.id;
    if (!id) return;

    if (!basicInfo) {
      // Not yet published — nothing to PATCH, just update the local draft view.
      setTournamentInfo({
        title: editTitle,
        location: editLocation,
        startDate: editStartDate,
        endDate: editIsOneDay ? editStartDate : editEndDate,
      });
      setShowBasicInfoEdit(false);
      return;
    }

    setBasicInfoSaving(true);
    setBasicInfoError('');
    try {
      const res = await fetch(`/api/tournaments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle,
          location: editLocation,
          startDate: editStartDate,
          endDate: editEndDate,
          isOneDay: editIsOneDay,
          description: editDescription,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to save changes');
      setBasicInfo({
        slug: body.slug,
        title: body.title,
        location: body.location,
        startDate: body.start_date,
        endDate: body.end_date,
        isOneDay: body.is_one_day,
        phase: body.phase,
        description: body.description,
      });
      setShowBasicInfoEdit(false);
    } catch (err) {
      setBasicInfoError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setBasicInfoSaving(false);
    }
  };

  // Format a Date into the value a datetime-local input expects (local time).
  const toLocalDatetimeValue = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // When the on-sand format changes, default Max Roster up to the new minimum
  // (only raising it — a manually entered larger roster is preserved).
  const handleFormatChange = (next: OnSandFormat) => {
    setFormatType(next);
    setMaxRoster(prev => (prev < FORMAT_PLAYERS[next] ? FORMAT_PLAYERS[next] : prev));
    setFormError(null);
  };

  // ── Tournament rounds builder ──────────────────────────────────
  const addRound = () => {
    setRounds([...rounds, { id: 'r_' + Date.now(), format: null, scoring: defaultScoringRules() }]);
    setFormError(null);
  };

  const setRoundFormat = (id: string, format: RoundFormat) => {
    setRounds(rounds.map(r => (r.id === id ? { ...r, format } : r)));
    setFormError(null);
  };

  const setRoundScoring = (id: string, patch: Partial<ScoringRules>) => {
    setRounds(rounds.map(r => (r.id === id ? { ...r, scoring: { ...r.scoring, ...patch } } : r)));
  };

  const removeRound = (id: string) => {
    if (rounds.length <= 1) return; // keep at least the first round
    setRounds(rounds.filter(r => r.id !== id));
  };

  // ── Per-division registration schema builders ──────────────────
  const isPresetActive = (key: PresetKey) => regFields.some(f => f.preset === key);

  const togglePreset = (key: PresetKey) => {
    if (isPresetActive(key)) {
      setRegFields(regFields.filter(f => f.preset !== key));
    } else {
      const preset = PRESETS.find(p => p.key === key);
      if (preset) setRegFields([...regFields, preset.build()]);
    }
  };

  const addCustomQuestion = () => {
    setRegFields([
      ...regFields,
      { id: 'q_' + Date.now(), label: '', type: 'text', required: false },
    ]);
  };

  const updateRegField = (id: string, patch: Partial<RegField>) => {
    setRegFields(regFields.map(f => (f.id === id ? { ...f, ...patch } : f)));
  };

  const removeRegField = (id: string) => {
    setRegFields(regFields.filter(f => f.id !== id));
  };

  // Helper Actions: Phase 1 (Create Division Modal Submission)
  const saveDivisionModal = async () => {
    if (!divName.trim()) {
      setFormError('Division name is required.');
      return;
    }
    // Structural constraint: roster must seat at least the on-sand format.
    if (maxRoster < FORMAT_PLAYERS[formatType]) {
      setFormError(`Max Roster Size must be at least ${FORMAT_PLAYERS[formatType]} to field a ${formatType} team.`);
      return;
    }
    // Every round needs a format chosen before saving.
    if (rounds.some(r => r.format === null)) {
      setFormError('Choose a format for every round.');
      return;
    }
    // Custom questions must be labelled before they can be saved.
    if (regFields.some(f => !f.core && !f.label.trim())) {
      setFormError('Every custom registration question needs a label.');
      return;
    }

    const data = {
      name: divName,
      divisionTeamCap: divCap,
      formatTypeOnSand: formatType,
      maxRosterSize: maxRoster,
      registrationFee: regFee,
      registrationOpenDate: regOpenDate,
      rounds,
      rules: divRules,
      regFields,
      allowMulti,
      genderEligibility,
      prizePool,
      netHeight,
      minTeams,
      waitlistCap,
      confirmationMessage,
      confirmationImage
    };

    const id = Array.isArray(params.id) ? params.id[0] : params.id;

    // Not yet published (no DB row to attach a division to) — keep the
    // previous local-only behavior; it'll be lost on refresh either way
    // until the tournament itself is published.
    if (!basicInfo || !id) {
      if (editingDivisionId) {
        setDivisions(divisions.map(d => d.id === editingDivisionId ? { ...d, ...data } : d));
        setActiveDivisionId(editingDivisionId);
      } else {
        const newId = 'd_' + Date.now();
        setDivisions([...divisions, { id: newId, ...data }]);
        setActiveDivisionId(newId);
      }
      setShowModal(false);
      return;
    }

    setDivisionSaving(true);
    setFormError(null);
    try {
      const res = await fetch(
        editingDivisionId ? `/api/tournaments/${id}/divisions/${editingDivisionId}` : `/api/tournaments/${id}/divisions`,
        {
          method: editingDivisionId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to save division');

      const saved = mapDbDivision({
        id: body.id,
        name: body.name,
        formatTypeOnSand: body.format_type_on_sand,
        registrationFee: body.registration_fee,
        divisionTeamCap: body.division_team_cap,
        regFields: body.reg_fields,
        settings: body.settings,
        rounds: (body.rounds ?? []).map((r: { id: string; sequence: number; format: string; name: string; scoring_rules: Record<string, unknown> }) => ({
          id: r.id,
          sequence: r.sequence,
          format: r.format,
          name: r.name,
          scoringRules: r.scoring_rules,
        })),
      });

      if (editingDivisionId) {
        setDivisions(divisions.map(d => d.id === editingDivisionId ? saved : d));
      } else {
        setDivisions([...divisions, saved]);
      }
      setActiveDivisionId(saved.id);
      setShowModal(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save division');
    } finally {
      setDivisionSaving(false);
    }
  };

  const removeDivision = async (id: string) => {
    const tournamentId = Array.isArray(params.id) ? params.id[0] : params.id;
    const next = divisions.filter(d => d.id !== id);

    if (basicInfo && tournamentId) {
      try {
        const res = await fetch(`/api/tournaments/${tournamentId}/divisions/${id}`, { method: 'DELETE' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to delete division');
        }
      } catch (err) {
        console.error(err);
        return;
      }
    }

    setDivisions(next);
    if (activeDivisionId === id) {
      setActiveDivisionId(next[0]?.id ?? null);
    }
  };

  // Helper Actions: Phase 2
  const lockQuestions = () => {
    setQuestionsLocked(true);
    setActivePhase(3); // Auto progress to Phase 3
  };

  const addQuestion = () => {
    if (!newQuestionLabel.trim()) return;
    const opts = newQuestionOptions.split(',').map(o => o.trim()).filter(Boolean);
    const newQ: Question = {
      id: Date.now().toString(),
      label: newQuestionLabel,
      type: newQuestionType,
      options: newQuestionType === 'select' ? opts : undefined,
      required: false
    };
    setQuestions([...questions, newQ]);
    setNewQuestionLabel('');
    setNewQuestionOptions('');
  };

  const removeQuestion = (id: string) => {
    setQuestions(questions.filter(q => q.id !== id));
  };

  // Helper Actions: Phase 3
  const simulateRegistration = (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);

    // Guardrail: check unique phone number against active entries
    const phoneExists = teams.some(t => t.phone === regPhone) || waitlist.some(t => t.phone === regPhone);
    if (phoneExists) {
      setRegError(`❌ Registration Blocked: Phone number ${regPhone} is already registered in Men's Open.`);
      return;
    }

    const newTeam: Team = {
      id: 't_' + Date.now(),
      name: regTeamName,
      phone: regPhone,
      email: regEmail,
      seed: teams.length + waitlist.length + 1,
      paymentCleared: false,
      registeredAt: new Date(),
      status: teams.length >= 6 ? 'waitlist' : 'unpaid'
    };

    if (teams.length >= 6) {
      setWaitlist([...waitlist, newTeam]);
    } else {
      setTeams([...teams, newTeam]);
    }

    setRegTeamName('');
    setRegPhone('');
    setRegEmail('');
  };

  const clearExpiredAndPromote = () => {
    const cutoff = new Date(Date.now() - 3600000 * 24);
    const paidOrFresh = teams.filter(t => t.paymentCleared || t.registeredAt > cutoff);
    const expiredCount = teams.length - paidOrFresh.length;

    if (expiredCount > 0 && waitlist.length > 0) {
      const promoted = waitlist.slice(0, expiredCount).map(t => ({ ...t, status: 'unpaid' as const, registeredAt: new Date() }));
      const remainingWaitlist = waitlist.slice(expiredCount);
      setTeams([...paidOrFresh, ...promoted]);
      setWaitlist(remainingWaitlist);
    } else {
      setTeams(paidOrFresh);
    }
  };

  const markPaid = (id: string) => {
    setTeams(teams.map(t => t.id === id ? { ...t, paymentCleared: true, status: 'confirmed' } : t));
  };

  // Helper Actions: Phase 4
  const moveSeed = (index: number, direction: 'up' | 'down') => {
    const updated = [...teams];
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= updated.length) return;
    const temp = updated[index];
    updated[index] = updated[target];
    updated[target] = temp;
    
    const ranked = updated.map((t, idx) => ({ ...t, seed: idx + 1 }));
    setTeams(ranked);

    if (scheduleGenerated) {
      runSerpentineSerpents(ranked);
    }
  };

  const runSerpentineSerpents = (currentTeams: Team[]) => {
    const pA: Team[] = [];
    const pB: Team[] = [];
    currentTeams.forEach((team, index) => {
      const snakeRound = Math.floor(index / 2);
      if (snakeRound % 2 === 0) {
        if (index % 2 === 0) pA.push(team);
        else pB.push(team);
      } else {
        if (index % 2 === 0) pB.push(team);
        else pA.push(team);
      }
    });
    setPoolA(pA);
    setPoolB(pB);
    setScheduleGenerated(true);
  };

  const swapPoolTeams = (teamId: string, targetPool: 'A' | 'B') => {
    if (targetPool === 'B') {
      const team = poolA.find(t => t.id === teamId);
      if (team) {
        setPoolA(poolA.filter(t => t.id !== teamId));
        setPoolB([...poolB, team]);
      }
    } else {
      const team = poolB.find(t => t.id === teamId);
      if (team) {
        setPoolB(poolB.filter(t => t.id !== teamId));
        setPoolA([...poolA, team]);
      }
    }
  };

  const addCourt = () => {
    if (newCourtName.trim() && !courts.includes(newCourtName)) {
      setCourts([...courts, newCourtName]);
      setNewCourtName('');
    }
  };

  const removeCourt = (court: string) => {
    setCourts(courts.filter(c => c !== court));
  };

  // The division shown in the per-division setup panel (falls back to the first).
  const activeDivision = divisions.find(d => d.id === activeDivisionId) ?? divisions[0] ?? null;

  // Basic info card prefers the real DB row; falls back to the unsaved draft.
  const displayTitle = basicInfo?.title ?? tournamentInfo?.title ?? '';
  const displayLocation = basicInfo?.location ?? tournamentInfo?.location;
  const displayStart = basicInfo?.startDate ?? tournamentInfo?.startDate;
  const displayEnd = basicInfo?.endDate ?? tournamentInfo?.endDate;
  const displayDescription = basicInfo?.description ?? '';
  const formatPillDate = (d?: string) => {
    if (!d) return '';
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const startPill = formatPillDate(displayStart);
  const endPill = displayEnd ? formatPillDate(displayEnd) : startPill;

  return (
    <div className={styles.page}>
      <Link
        href="/dashboard"
        className={`${styles.backLink} ${backHidden ? styles.backLinkHidden : ''}`}
        aria-label="Back to Dashboard"
      >
        <ArrowLeft size={18} />
      </Link>

      <main className={styles.main}>
        <div className={styles.container}>
          <div className={styles.headerArea}>
            <h1 className={styles.title}>Tournament Setup</h1>
          </div>

          {/* ── Basic Info ───────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 24, marginBottom: 24, alignItems: 'stretch' }}>
            {/* Card 1: Poster Image */}
            <section 
              className={styles.card} 
              style={{ width: 220, padding: 0, overflow: 'hidden', flexShrink: 0, border: 'none', display: 'flex', flexDirection: 'column', position: 'relative' }}
              onMouseEnter={() => setPosterHover(true)}
              onMouseLeave={() => setPosterHover(false)}
            >
               {basicInfo?.imageUrl ? (
                 <img src={basicInfo.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', aspectRatio: '1 / 1.414' }} />
               ) : (
                 <div style={{ width: '100%', height: '100%', minHeight: 311, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.03)', color: '#9ca3af' }}>
                   <ImagePlus size={40} opacity={0.5} />
                 </div>
               )}

               {/* Hover Overlay */}
               {posterHover && (
                 <div style={{ 
                   position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, 
                   backgroundColor: 'rgba(0,0,0,0.6)', 
                   display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
                   transition: 'opacity 0.2s', zIndex: 10
                 }}>
                    {basicInfo?.imageUrl && (
                      <button 
                        onClick={() => window.open(basicInfo.imageUrl, '_blank')}
                        style={{ width: 140, padding: '10px 16px', borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
                      >
                        <Eye size={16} /> View
                      </button>
                    )}
                    <button 
                      onClick={() => { setTempPoster(basicInfo?.imageUrl || ''); setShowPosterModal(true); }}
                      style={{ width: 140, padding: '10px 16px', borderRadius: 24, backgroundColor: '#EE7A4C', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
                    >
                      <UploadCloud size={16} /> Re-Upload
                    </button>
                 </div>
               )}
            </section>

            {/* Card 2: Tournament Info */}
            <section className={styles.card} style={{ flex: 1, padding: 0, display: 'flex', overflow: 'hidden', minHeight: 240, border: 'none', position: 'relative' }}>
              {/* Background Image with Overlay */}
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0 }}>
                {basicInfo?.imageUrl ? (
                  <img src={basicInfo.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', backgroundColor: '#1F2937' }} />
                )}
                {/* Dark Gradient Overlay for readability */}
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'linear-gradient(90deg, rgba(17,24,39,0.95) 0%, rgba(17,24,39,0.75) 50%, rgba(17,24,39,0.4) 100%)' }} />
              </div>

              {/* Foreground Content */}
              <div style={{ position: 'relative', zIndex: 1, display: 'flex', width: '100%' }}>
                {/* Content column */}
                <div style={{ flex: 1, padding: 32, display: 'flex', flexDirection: 'column', color: '#fff' }}>
                  <div className={styles.cardHeader} style={{ padding: 0, border: 'none', marginBottom: 16 }}>
                    <div style={{ flex: 1 }}>
                      <h2 style={{ fontSize: 36, fontWeight: 800, fontFamily: 'var(--font-heading), sans-serif', letterSpacing: '-0.02em', color: '#fff', marginBottom: 16 }}>
                        {displayTitle || 'Untitled tournament'}
                      </h2>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 16, color: '#D1D5DB', fontSize: 15, fontWeight: 500 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Calendar size={18} opacity={0.7} />
                          <span>{startPill}{displayEnd && displayEnd !== displayStart ? ` to ${endPill}` : ''}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <MapPin size={18} opacity={0.7} />
                          <span>{displayLocation}</span>
                        </div>
                      </div>
                    </div>
                    <div className={styles.divActions}>
                      <button type="button" className={styles.btnGhost} onClick={openBasicInfoEdit} style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }}>
                        <Pencil size={15} /> Edit
                      </button>
                    </div>
                  </div>
                  {displayDescription ? (
                    <div className={styles.sectionBody} style={{ padding: 0, flex: 1, marginTop: 12 }}>
                      <p className={styles.summaryText} style={{ margin: 0, color: 'rgba(255,255,255,0.85)', fontSize: 15, lineHeight: 1.6 }}>{displayDescription}</p>
                    </div>
                  ) : (
                    <div className={styles.sectionBody} style={{ padding: 0, flex: 1, marginTop: 12 }}>
                      <p className={styles.summaryText} style={{ margin: 0, fontStyle: 'italic', opacity: 0.5, color: '#fff' }}>No description provided.</p>
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>

          {divisionsLoading ? (
            <div className={styles.emptyDivisions}>
              <p className={styles.emptyDivisionsHint}>Loading divisions…</p>
            </div>
          ) : divisions.length === 0 ? (
            <div className={styles.emptyDivisions}>
              <button type="button" className={styles.bigAddDivision} onClick={handleOpenCreateModal}>
                <Plus size={34} />
                <span>Add Division</span>
              </button>
              <p className={styles.emptyDivisionsHint}>
                Create your first division to start configuring formats, rules, and registration.
              </p>
            </div>
          ) : (
            <>
              {/* Division toggle (section control) */}
              <div className={styles.divisionToggle}>
                {divisions.map(d => (
                  <button
                    key={d.id}
                    type="button"
                    className={`${styles.divToggleBtn} ${activeDivision?.id === d.id ? styles.divToggleBtnActive : ''}`}
                    onClick={() => setActiveDivisionId(d.id)}
                  >
                    {d.name}
                  </button>
                ))}
                <button type="button" className={styles.divToggleAdd} onClick={handleOpenCreateModal}>
                  <Plus size={16} /> Add Division
                </button>
              </div>

              {/* Per-division setup */}
              {activeDivision && (
                <section className={styles.card}>
                  <div className={styles.cardHeader}>
                    <Layers className={styles.iconHeader} size={22} />
                    <div style={{ flex: 1 }}>
                      <h2 className={styles.cardTitle}>{activeDivision.name}</h2>
                      <p className={styles.cardSubtitle}>
                        {activeDivision.genderEligibility} • {activeDivision.formatTypeOnSand} • {activeDivision.rounds.length} round{activeDivision.rounds.length > 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className={styles.divActions}>
                      <button type="button" className={styles.btnGhost} onClick={() => handleEditDivision(activeDivision.id)}>
                        <Pencil size={15} /> Edit
                      </button>
                      <button type="button" className={styles.btnRemove} onClick={() => removeDivision(activeDivision.id)} aria-label="Delete division">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <div className={styles.sectionBody}>
                    <div className={styles.summaryGrid}>
                      <div className={styles.summaryItem}><span>Team Cap</span><strong>{activeDivision.divisionTeamCap} teams</strong></div>
                      <div className={styles.summaryItem}><span>On-Sand Format</span><strong>{activeDivision.formatTypeOnSand}</strong></div>
                      <div className={styles.summaryItem}><span>Max Roster</span><strong>{activeDivision.maxRosterSize} players</strong></div>
                      <div className={styles.summaryItem}><span>Registration Fee</span><strong>{activeDivision.registrationFee === 0 ? 'Free' : `${activeDivision.registrationFee} THB`}</strong></div>
                      <div className={styles.summaryItem}><span>Registration Opens</span><strong>{activeDivision.registrationOpenDate ? new Date(activeDivision.registrationOpenDate).toLocaleString() : 'Immediately'}</strong></div>
                      <div className={styles.summaryItem}><span>Net Height</span><strong>{activeDivision.netHeight}</strong></div>
                    </div>

                    <hr className={styles.divider} />

                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel}>Competition Format</label>
                      <div className={styles.summaryChips}>
                        {activeDivision.rounds.map((r, i) => (
                          <span key={r.id} className={styles.summaryChip}>
                            {roundLabel(i)}: {ROUND_FORMATS.find(f => f.value === r.format)?.label ?? '—'}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel}>Scoring</label>
                      {activeDivision.rounds.map((r, i) => (
                        <p key={r.id} className={styles.summaryText}>
                          <strong>{roundLabel(i)}:</strong> Best of {r.scoring.setsBestOf} • Sets to {r.scoring.pointsPerSet}{r.scoring.winBy2 ? ' (win by 2)' : ''}{r.scoring.hardCap ? `, hard cap ${r.scoring.hardCap}` : ''} • Deciding set to {r.scoring.decidingSetPoints}
                        </p>
                      ))}
                    </div>

                    {activeDivision.rules && (
                      <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>Rules</label>
                        <p className={styles.summaryText}>{activeDivision.rules}</p>
                      </div>
                    )}

                    <hr className={styles.divider} />

                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel}>Registration Form</label>
                      <div className={styles.summaryChips}>
                        {activeDivision.regFields.map(f => (
                          <span key={f.id} className={`${styles.summaryChip} ${f.core ? styles.summaryChipCore : ''}`}>
                            {f.label}{f.required ? ' *' : ''}
                          </span>
                        ))}
                      </div>
                    </div>

                    {(activeDivision.confirmationMessage || activeDivision.confirmationImage) && (
                      <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>Registration Response</label>
                        {activeDivision.confirmationMessage && (
                          <p className={styles.summaryText}>{activeDivision.confirmationMessage}</p>
                        )}
                        {activeDivision.confirmationImage && (
                          <div className={styles.confirmImagePreview} style={{ marginTop: 8 }}>
                            <img src={activeDivision.confirmationImage} alt="Registration response attachment" />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </main>

      {/* ── CREATE DIVISION MODAL ─────────────────────────────────── */}
      {showModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h3>{editingDivisionId ? 'Edit Division' : 'Create New Division'}</h3>
              <button className={styles.modalCloseBtn} onClick={() => setShowModal(false)}>×</button>
            </div>

            {/* ── Step navigation line ─────────────────────────── */}
            <div className={styles.modalSteps}>
              {MODAL_STEPS.map((label, i) => (
                <div key={label} className={styles.modalStepRow}>
                  <button
                    type="button"
                    className={`${styles.modalStepItem} ${i === modalStep ? styles.modalStepActive : ''} ${i < modalStep ? styles.modalStepDone : ''}`}
                    onClick={() => goToModalStep(i)}
                  >
                    <span className={styles.modalStepDot}>
                      {i < modalStep ? <Check size={13} strokeWidth={3} /> : i + 1}
                    </span>
                    <span className={styles.modalStepLabel}>{label}</span>
                  </button>
                  {i < MODAL_STEPS.length - 1 && (
                    <span className={`${styles.modalStepLine} ${i < modalStep ? styles.modalStepLineDone : ''}`} />
                  )}
                </div>
              ))}
            </div>

            <div className={styles.modalBody}>
              {formError && (
                <div className={styles.modalFormError}>{formError}</div>
              )}

              {/* ══ Step 1: Basics & Fee ═════════════════════════ */}
              {modalStep === 0 && (
              <>
              {/* ── A. Basics & Dynamic Capacity ─────────────────── */}
              <p className={styles.modalSectionTitle}>Basics &amp; Capacity</p>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Division Name *</label>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="e.g. Women's Open, Mixed 4s"
                  value={divName}
                  onChange={e => { setDivName(e.target.value); setFormError(null); }}
                />
              </div>

              <div className={styles.twoCol} style={{ marginTop: 12 }}>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Team Cap (Max Teams) *</label>
                  <input
                    type="number"
                    className={styles.input}
                    min={2}
                    value={divCap}
                    onChange={e => setDivCap(parseInt(e.target.value) || 8)}
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Format *</label>
                  <select
                    className={styles.select}
                    value={formatType}
                    onChange={e => handleFormatChange(e.target.value as OnSandFormat)}
                  >
                    <option value="2v2">2 v 2</option>
                    <option value="3v3">3 v 3</option>
                    <option value="4v4">4 v 4</option>
                    <option value="6v6">6 v 6</option>
                  </select>
                </div>
              </div>

              <div className={styles.fieldGroup} style={{ marginTop: 12 }}>
                <label className={styles.fieldLabel}>Max Roster Size *</label>
                <input
                  type="number"
                  className={styles.input}
                  min={FORMAT_PLAYERS[formatType]}
                  value={maxRoster}
                  onChange={e => { setMaxRoster(parseInt(e.target.value) || 0); setFormError(null); }}
                />
                <span className={styles.fieldHint}>
                  Minimum {FORMAT_PLAYERS[formatType]} for {formatType}. Raise it to allow substitutes / alternates.
                </span>
              </div>

              {/* ── B. Fees ──────────────────────────────────────── */}
              <p className={styles.modalSectionTitle}>Fees</p>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Registration Fee (THB) *</label>
                <input
                  type="number"
                  className={styles.input}
                  min={0}
                  value={regFee}
                  onChange={e => setRegFee(parseInt(e.target.value) || 0)}
                />
                <span className={styles.fieldHint}>Flat per team slot. Enter 0 for a free division.</span>
              </div>
              </>
              )}

              {/* ══ Step 2: Format & Rules ═══════════════════════ */}
              {modalStep === 1 && (
              <>
              {/* ── C. Rules & Formats ───────────────────────────── */}
              <p className={styles.modalSectionTitle}>Rules &amp; Formats</p>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Competition Format *</label>
                <p className={styles.fieldHint} style={{ marginTop: -2 }}>
                  Build the tournament one round at a time. Each round has its own format and
                  scoring — e.g. pool play to 21 points, then a best-of-3 elimination bracket.
                </p>
                <div className={styles.roundsList}>
                  {rounds.map((round, i) => (
                    <div key={round.id} className={styles.roundCard}>
                      <div className={styles.roundCardHeader}>
                        <span className={styles.roundName}>{roundLabel(i)}</span>
                        {round.format === null && (
                          <span className={styles.roundPrompt}>click to choose format</span>
                        )}
                        {rounds.length > 1 && (
                          <button
                            type="button"
                            className={styles.btnRemove}
                            onClick={() => removeRound(round.id)}
                            aria-label={`Remove ${roundLabel(i)}`}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                      <div className={styles.selectorGroup}>
                        {ROUND_FORMATS.map(opt => (
                          <button
                            key={opt.value}
                            type="button"
                            className={`${styles.selectorBtn} ${round.format === opt.value ? styles.selectorBtnActive : ''}`}
                            onClick={() => setRoundFormat(round.id, opt.value)}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      {round.format !== null && (
                        <div className={styles.scoringMatrix} style={{ marginTop: 12 }}>
                          <div className={styles.scoringRow}>
                            <span className={styles.scoringRowLabel}>Match</span>
                            <label className={styles.scoringCell}>
                              <span>Best of</span>
                              <select
                                className={styles.scoringInput}
                                value={round.scoring.setsBestOf}
                                onChange={e => setRoundScoring(round.id, { setsBestOf: parseInt(e.target.value) })}
                              >
                                <option value={1}>1</option>
                                <option value={3}>3</option>
                                <option value={5}>5</option>
                              </select>
                            </label>
                            <label className={styles.scoringCell}>
                              <input
                                type="checkbox"
                                checked={round.scoring.winBy2}
                                onChange={e => setRoundScoring(round.id, { winBy2: e.target.checked })}
                              />
                              <span>Win by 2</span>
                            </label>
                          </div>
                          <div className={styles.scoringRow}>
                            <span className={styles.scoringRowLabel}>Sets 1 &amp; 2</span>
                            <label className={styles.scoringCell}>
                              <span>to</span>
                              <input
                                type="number"
                                className={styles.scoringInput}
                                min={1}
                                value={round.scoring.pointsPerSet}
                                onChange={e => setRoundScoring(round.id, { pointsPerSet: parseInt(e.target.value) || 0 })}
                              />
                            </label>
                            <label className={styles.scoringCell}>
                              <span>Hard cap</span>
                              <input
                                type="number"
                                className={styles.scoringInput}
                                min={0}
                                placeholder="none"
                                value={round.scoring.hardCap || ''}
                                onChange={e => setRoundScoring(round.id, { hardCap: parseInt(e.target.value) || 0 })}
                              />
                            </label>
                          </div>
                          <div className={styles.scoringRow}>
                            <span className={styles.scoringRowLabel}>Deciding set</span>
                            <label className={styles.scoringCell}>
                              <span>to</span>
                              <input
                                type="number"
                                className={styles.scoringInput}
                                min={1}
                                value={round.scoring.decidingSetPoints}
                                onChange={e => setRoundScoring(round.id, { decidingSetPoints: parseInt(e.target.value) || 0 })}
                              />
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <button type="button" className={styles.btnAdd} onClick={addRound} style={{ marginTop: 10, width: '100%' }}>
                  <Plus size={16} /> Add Round
                </button>
              </div>

              <div className={styles.fieldGroup} style={{ marginTop: 12 }}>
                <label className={styles.fieldLabel}>Competition Rules (Optional)</label>
                <textarea
                  className={styles.textarea}
                  rows={2}
                  placeholder="Rules specific to this division..."
                  value={divRules}
                  onChange={e => setDivRules(e.target.value)}
                />
              </div>
              </>
              )}

              {/* ══ Step 3: Registration ═════════════════════════ */}
              {modalStep === 2 && (
              <>
              {/* ── Registration Open Date ───────────────────────── */}
              <p className={styles.modalSectionTitle}>Registration Opens</p>
              <div className={styles.fieldGroup}>
                <label className={styles.switchRow} style={{ marginTop: 0 }}>
                  <span className={styles.switchText}>Open registration immediately</span>
                  <span className={styles.switch}>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={isOpenImmediately}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setIsOpenImmediately(checked);
                        if (checked) {
                          setRegOpenDate('');
                        } else {
                          const tomorrow = new Date();
                          tomorrow.setDate(tomorrow.getDate() + 1);
                          tomorrow.setHours(9, 0, 0, 0);
                          setRegOpenDate(toLocalDatetimeValue(tomorrow));
                        }
                      }}
                    />
                    <span className={styles.switchTrack}>
                      <span className={styles.switchThumb} />
                    </span>
                  </span>
                </label>

                {!isOpenImmediately && (
                  <div style={{ marginTop: 10 }}>
                    <input
                      type="datetime-local"
                      className={styles.input}
                      value={regOpenDate}
                      onChange={e => setRegOpenDate(e.target.value)}
                    />
                  </div>
                )}
                <span className={styles.fieldHint} style={{ marginTop: 6 }}>
                  {isOpenImmediately
                    ? 'Registration is open immediately.'
                    : 'Staggered window for this division only.'}
                </span>
              </div>

              {/* ── Per-division Registration Form ───────────────── */}
              <p className={styles.modalSectionTitle}>Registration Form</p>
              <p className={styles.fieldHint} style={{ marginTop: -4 }}>
                This form is bound to this division only.
              </p>

              {/* Non-deletable Base Form block */}
              <div className={styles.baseBlock}>
                <div className={styles.baseBlockHeader}>
                  <Lock size={13} /> Base Form (always collected)
                </div>
                <div className={styles.baseBlockGrid}>
                  {regFields.filter(f => f.core).map(f => (
                    <div key={f.id} className={styles.coreField}>
                      <span>{f.label}</span>
                      <span className={styles.coreFieldTag}>Required</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick-Add preset chips */}
              <div className={styles.chipRow}>
                {PRESETS.map(p => (
                  <button
                    key={p.key}
                    type="button"
                    className={`${styles.chip} ${isPresetActive(p.key) ? styles.chipActive : ''}`}
                    onClick={() => togglePreset(p.key)}
                  >
                    {isPresetActive(p.key) ? <Check size={13} /> : <Plus size={13} />} {p.label}
                  </button>
                ))}
              </div>

              {/* Appended fields (presets + custom questions) */}
              {regFields.filter(f => !f.core).length > 0 && (
                <div className={styles.appendedFields}>
                  {regFields.filter(f => !f.core).map(f =>
                    f.preset ? (
                      <div key={f.id} className={styles.presetRow}>
                        <span className={styles.presetRowLabel}>{f.label}</span>
                        <span className={styles.questionType}>
                          {f.type === 'select' ? `${f.options?.length ?? 0}-option dropdown` : 'short text'}
                        </span>
                        <button className={styles.btnRemove} onClick={() => removeRegField(f.id)}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ) : (
                      <div key={f.id} className={styles.customRow}>
                        <div className={styles.customRowTop}>
                          <input
                            type="text"
                            className={styles.input}
                            placeholder="Field label (e.g. Team walk-out song?)"
                            value={f.label}
                            onChange={e => updateRegField(f.id, { label: e.target.value })}
                          />
                          <button className={styles.btnRemove} onClick={() => removeRegField(f.id)}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                        <div className={styles.customRowBottom}>
                          <select
                            className={styles.select}
                            value={f.type}
                            onChange={e => updateRegField(f.id, { type: e.target.value as RegFieldType })}
                          >
                            <option value="text">Short Text</option>
                            <option value="paragraph">Paragraph</option>
                            <option value="select">Multiple Choice Dropdown</option>
                          </select>
                          <label className={styles.checkboxInline}>
                            <input
                              type="checkbox"
                              checked={f.required}
                              onChange={e => updateRegField(f.id, { required: e.target.checked })}
                            />
                            Required
                          </label>
                        </div>
                        {f.type === 'select' && (
                          <input
                            type="text"
                            className={styles.input}
                            style={{ marginTop: 8 }}
                            placeholder="Options, comma-separated (e.g. Yes, No, Maybe)"
                            value={(f.options ?? []).join(', ')}
                            onChange={e => updateRegField(f.id, { options: e.target.value.split(',').map(o => o.trim()).filter(Boolean) })}
                          />
                        )}
                      </div>
                    )
                  )}
                </div>
              )}

              <button type="button" className={styles.btnAdd} onClick={addCustomQuestion} style={{ marginTop: 12, width: '100%' }}>
                <Plus size={16} /> Add Custom Question
              </button>

              {/* ── Post-registration Response ───────────────────── */}
              <p className={styles.modalSectionTitle}>Registration Response</p>
              <p className={styles.fieldHint} style={{ marginTop: -4 }}>
                Shown to players right after they successfully register — e.g. a WhatsApp group invite,
                a Facebook page link, or a QR code to join for announcements.
              </p>
              <div className={styles.fieldGroup}>
                <textarea
                  className={styles.textarea}
                  rows={3}
                  placeholder="e.g. You're in! 🏐 Join our WhatsApp group for schedule updates: https://chat.whatsapp.com/..."
                  value={confirmationMessage}
                  onChange={e => setConfirmationMessage(e.target.value)}
                />
              </div>
              <div className={styles.fieldGroup} style={{ marginTop: 10 }}>
                {confirmationImage ? (
                  <div className={styles.confirmImagePreview}>
                    <img src={confirmationImage} alt="Registration response attachment" />
                    <button
                      type="button"
                      className={styles.confirmImageRemove}
                      onClick={() => setConfirmationImage('')}
                      aria-label="Remove photo"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ) : (
                  <label className={styles.btnAdd} style={{ width: '100%', cursor: 'pointer' }}>
                    <ImagePlus size={16} /> Add Photo (WhatsApp QR, flyer, etc.)
                    <input type="file" accept="image/*" hidden onChange={handleConfirmationImage} />
                  </label>
                )}
              </div>

              {/* Collapsible Advanced / Missing Options */}
              <div className={styles.advancedCollapsible}>
                <button
                  type="button"
                  className={styles.advancedToggleBtn}
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  <span>Advanced Settings (Automatic recommendations)</span>
                  <ChevronDown
                    size={16}
                    style={{
                      transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s'
                    }}
                  />
                </button>

                {showAdvanced && (
                  <div className={styles.advancedFieldsPanel}>
                    <p style={{ fontSize: 11.5, color: '#D35400', marginBottom: 12, lineHeight: 1.4 }}>
                      ⚠️ <strong>Missing Parameters Detected:</strong> To ensure high-quality competition scoring and player logistics, we recommend configuring these 5 additional fields:
                    </p>

                    <div className={styles.twoCol}>
                      <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>1. Gender/Eligibility</label>
                        <select
                          className={styles.select}
                          value={genderEligibility}
                          onChange={e => setGenderEligibility(e.target.value)}
                        >
                          <option value="Mixed">Mixed / Co-Ed</option>
                          <option value="Men">Men Only</option>
                          <option value="Women">Women Only</option>
                          <option value="Youth">Youth / Under-18</option>
                        </select>
                      </div>
                      <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>2. Net Height</label>
                        <input
                          type="text"
                          className={styles.input}
                          placeholder="e.g. 2.43m (Men), 2.24m (Women)"
                          value={netHeight}
                          onChange={e => setNetHeight(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className={styles.twoCol} style={{ marginTop: 10 }}>
                      <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>3. Min Teams Count</label>
                        <input
                          type="number"
                          className={styles.input}
                          min={2}
                          value={minTeams}
                          onChange={e => setMinTeams(parseInt(e.target.value) || 4)}
                        />
                      </div>
                      <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>4. Waitlist Cap</label>
                        <input
                          type="number"
                          className={styles.input}
                          min={0}
                          value={waitlistCap}
                          onChange={e => setWaitlistCap(parseInt(e.target.value) || 0)}
                        />
                      </div>
                    </div>

                    <div className={styles.fieldGroup} style={{ marginTop: 10 }}>
                      <label className={styles.fieldLabel}>5. Prizes &amp; Payout Structure</label>
                      <input
                        type="text"
                        className={styles.input}
                        placeholder="e.g. Cash 1st: 50%, 2nd: 30%, 3rd: 20%"
                        value={prizePool}
                        onChange={e => setPrizePool(e.target.value)}
                      />
                    </div>

                    <div className={styles.fieldGroup} style={{ marginTop: 10 }}>
                      <label className={styles.fieldLabel}>6. Allow Multi-Division Play</label>
                      <select
                        className={styles.select}
                        value={allowMulti ? 'yes' : 'no'}
                        onChange={e => setAllowMulti(e.target.value === 'yes')}
                      >
                        <option value="yes">Yes (Allow players to cross-register)</option>
                        <option value="no">No (Strict single-division lock)</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
              </>
              )}
            </div>
            <div className={styles.modalFooter}>
              {modalStep === 0 ? (
                <button className={styles.btnGhost} onClick={() => setShowModal(false)}>Cancel</button>
              ) : (
                <button className={styles.btnGhost} onClick={handleModalBack}>
                  <ArrowLeft size={15} /> Back
                </button>
              )}
              {modalStep < MODAL_STEPS.length - 1 ? (
                <button className={styles.btnActionPrimary} onClick={handleModalNext}>
                  Next <ChevronRight size={16} />
                </button>
              ) : (
                <button className={styles.btnActionPrimary} onClick={saveDivisionModal} disabled={divisionSaving}>
                  {divisionSaving ? 'Saving…' : editingDivisionId ? 'Save Division' : 'Create Division'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT BASIC INFO MODAL ─────────────────────────────────── */}
      {showBasicInfoEdit && (
        <div className={styles.modalOverlay} onClick={() => setShowBasicInfoEdit(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Edit Basic Info</h3>
              <button className={styles.modalCloseBtn} onClick={() => setShowBasicInfoEdit(false)}><X size={18} /></button>
            </div>
            <div className={styles.modalBody}>
              {basicInfoError && <div className={styles.modalFormError}>{basicInfoError}</div>}

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Tournament Name *</label>
                <input className={styles.input} type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)} />
              </div>

              <div className={styles.fieldGroup} style={{ marginTop: 12 }}>
                <label className={styles.fieldLabel}>Location *</label>
                <input className={styles.input} type="text" value={editLocation} onChange={e => setEditLocation(e.target.value)} />
              </div>

              <div className={styles.twoCol} style={{ marginTop: 12 }}>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Start date *</label>
                  <input
                    className={styles.input}
                    type="date"
                    value={editStartDate}
                    onChange={e => {
                      setEditStartDate(e.target.value);
                      if (editIsOneDay) setEditEndDate(e.target.value);
                    }}
                  />
                  <label className={styles.switchRow}>
                    <span className={styles.switch}>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={editIsOneDay}
                        onChange={e => {
                          const checked = e.target.checked;
                          setEditIsOneDay(checked);
                          if (checked && editStartDate) setEditEndDate(editStartDate);
                        }}
                      />
                      <span className={styles.switchTrack}><span className={styles.switchThumb} /></span>
                    </span>
                    <span className={styles.switchText}>One-Day Tournament</span>
                  </label>
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>End date</label>
                  <input
                    className={styles.input}
                    type="date"
                    disabled={editIsOneDay}
                    value={editIsOneDay ? editStartDate : editEndDate}
                    onChange={e => setEditEndDate(e.target.value)}
                  />
                </div>
              </div>

              <div className={styles.fieldGroup} style={{ marginTop: 12 }}>
                <label className={styles.fieldLabel}>Description</label>
                <textarea
                  className={styles.textarea}
                  rows={3}
                  placeholder="Optional — tell players what to expect..."
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                />
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.btnGhost} onClick={() => setShowBasicInfoEdit(false)}>Cancel</button>
              <button className={styles.btnActionPrimary} onClick={saveBasicInfo} disabled={basicInfoSaving}>
                {basicInfoSaving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── POSTER UPLOAD MODAL ───────────────────────────────────── */}
      {showPosterModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent} style={{ maxWidth: 400 }}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Upload Poster</h2>
              <button className={styles.modalCloseBtn} onClick={() => setShowPosterModal(false)}>×</button>
            </div>
            <div className={styles.modalBody}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {tempPoster ? (
                  <img src={tempPoster} alt="Preview" style={{ width: '100%', aspectRatio: '1 / 1.414', objectFit: 'cover', borderRadius: 8, border: '1px solid #E5E7EB' }} />
                ) : (
                  <div style={{ width: '100%', aspectRatio: '1 / 1.414', backgroundColor: '#F3F4F6', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed #D1D5DB' }}>
                    <span style={{ color: '#6B7280', fontSize: 14 }}>No image selected</span>
                  </div>
                )}
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px', backgroundColor: '#EEF2FE', color: '#204ECF', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
                  <UploadCloud size={18} style={{ marginRight: 8 }} />
                  Choose File
                  <input type="file" accept="image/*" onChange={handlePosterUpload} hidden />
                </label>
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.btnGhost} onClick={() => setShowPosterModal(false)}>Cancel</button>
              <button className={styles.btnActionPrimary} onClick={savePoster} disabled={!tempPoster}>Save Image</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
