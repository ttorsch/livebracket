'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { 
  Check, 
  ChevronRight, 
  Plus, 
  Trash2, 
  Settings, 
  Globe, 
  Lock, 
  Calendar, 
  BookOpen, 
  Info, 
  Sparkles, 
  Gift, 
  ListPlus,
  Save,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Trash,
  Clock,
  Layers,
  Award,
  ChevronDown
} from 'lucide-react';
import styles from './page.module.css';

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
type PresetKey = 'apparel' | 'skill' | 'hometown';

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
type CompFormat = 'pool' | 'single' | 'double' | 'hybrid';

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
  competitionFormat: CompFormat;
  scoringRules: ScoringRules;
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
}

// Players on the sand per format → also the minimum legal roster size.
const FORMAT_PLAYERS: Record<OnSandFormat, number> = { '2v2': 2, '3v3': 3, '4v4': 4, '6v6': 6 };

// The Base Form block: four mandatory core inputs, injected into every new
// division and non-deletable.
const makeBaseFields = (): RegField[] => [
  { id: 'base-team', label: 'Team Name', type: 'text', required: true, core: true },
  { id: 'base-captain', label: 'Captain Name', type: 'text', required: true, core: true },
  { id: 'base-phone', label: 'Phone', type: 'phone', required: true, core: true },
  { id: 'base-email', label: 'Email', type: 'email', required: true, core: true },
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
];

const defaultScoringRules = (): ScoringRules => ({
  setsBestOf: 3,
  pointsPerSet: 21,
  winBy2: true,
  hardCap: 0,
  decidingSetPoints: 15,
});

export default function OrganizerSetup() {
  const params = useParams();
  const router = useRouter();

  // Active Map Phase: 1 = Initial Shell, 2 = Rules Announced, 3 = Live Reg, 4 = Logistics (Day Before)
  const [activePhase, setActivePhase] = useState<1 | 2 | 3 | 4>(1);

  // Phase 1 States: Division Modal & List
  const [showModal, setShowModal] = useState(false);
  const [divisions, setDivisions] = useState<SetupDivision[]>([
    {
      id: 'd1',
      name: "Men's Open",
      divisionTeamCap: 8,
      formatTypeOnSand: '2v2',
      maxRosterSize: 2,
      registrationFee: 800,
      registrationOpenDate: '',
      competitionFormat: 'hybrid',
      scoringRules: defaultScoringRules(),
      rules: 'Standard FIVB Beach Volleyball rules apply.',
      regFields: makeBaseFields(),
      allowMulti: true,
      genderEligibility: 'Men',
      prizePool: '10,000 THB Prize Pool + Gold Medal',
      netHeight: '2.43m',
      minTeams: 4,
      waitlistCap: 5
    }
  ]);

  // Modal Form Inputs — A. Basics & dynamic capacity
  const [divName, setDivName] = useState("Women's Open");
  const [divCap, setDivCap] = useState(8);
  const [formatType, setFormatType] = useState<OnSandFormat>('2v2');
  const [maxRoster, setMaxRoster] = useState(2);
  // B. Staggered timing & fees
  const [regFee, setRegFee] = useState(800);
  const [regOpenDate, setRegOpenDate] = useState('');
  // C. Rules & formats
  const [compFormat, setCompFormat] = useState<CompFormat>('hybrid');
  const [scoring, setScoring] = useState<ScoringRules>(defaultScoringRules());
  const [divRules, setDivRules] = useState('Standard FIVB Beach Volleyball rules apply.');

  // Per-division registration schema (isolated to this division)
  const [regFields, setRegFields] = useState<RegField[]>(makeBaseFields());

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

  const [rules, setRules] = useState('Standard FIVB Beach Volleyball rules apply. Matches are best of 3 sets to 21 points (third set to 15 if needed). Warm-ups are strictly limited to 5 minutes.');
  const [venueInfo, setVenueInfo] = useState('Memories Beach, Khao Lak. Food and drinks are available at the beach club. Free parking is available for players.');
  const [saved, setSaved] = useState(false);

  // Modal open reset
  const handleOpenCreateModal = () => {
    setDivName(`Women's Open`);
    setDivCap(8);
    setFormatType('2v2');
    setMaxRoster(FORMAT_PLAYERS['2v2']);
    setRegFee(800);
    setRegOpenDate('');
    setCompFormat('hybrid');
    setScoring(defaultScoringRules());
    setDivRules('Standard FIVB Beach Volleyball rules apply.');
    setRegFields(makeBaseFields());
    setFormError(null);
    setAllowMulti(true);
    setGenderEligibility('Women');
    setPrizePool('');
    setNetHeight('2.24m');
    setMinTeams(4);
    setWaitlistCap(5);
    setShowAdvanced(false);
    setShowModal(true);
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
  const saveDivisionModal = () => {
    if (!divName.trim()) {
      setFormError('Division name is required.');
      return;
    }
    // Structural constraint: roster must seat at least the on-sand format.
    if (maxRoster < FORMAT_PLAYERS[formatType]) {
      setFormError(`Max Roster Size must be at least ${FORMAT_PLAYERS[formatType]} to field a ${formatType} team.`);
      return;
    }
    // Custom questions must be labelled before they can be saved.
    if (regFields.some(f => !f.core && !f.label.trim())) {
      setFormError('Every custom registration question needs a label.');
      return;
    }

    const newDiv: SetupDivision = {
      id: 'd_' + Date.now(),
      name: divName,
      divisionTeamCap: divCap,
      formatTypeOnSand: formatType,
      maxRosterSize: maxRoster,
      registrationFee: regFee,
      registrationOpenDate: regOpenDate,
      competitionFormat: compFormat,
      scoringRules: scoring,
      rules: divRules,
      regFields,
      allowMulti,
      genderEligibility,
      prizePool,
      netHeight,
      minTeams,
      waitlistCap
    };
    setDivisions([...divisions, newDiv]);
    setShowModal(false);
    setActivePhase(2); // Auto progress to Phase 2 as per flowchart
  };

  const removeDivision = (id: string) => {
    setDivisions(divisions.filter(d => d.id !== id));
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

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      router.push('/dashboard');
    }, 1500);
  };

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <div className={styles.container}>
          <div className={styles.topBarInner}>
            <Link href="/dashboard" className={styles.backLink}>
              <ArrowLeft size={16} /> Back to Dashboard
            </Link>
            <div className={styles.topBarActions}>
              <button className={styles.btnSave} onClick={handleSave}>
                <Save size={16} /> Save Setup
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.container}>
          <div className={styles.headerArea}>
            <h1 className={styles.title}>Pre-Tournament Workspace</h1>
            <p className={styles.subtitle}>Track setup tasks, registrations, and brackets according to the Operational Map.</p>
          </div>

          {/* Operational Map Timeline */}
          <div className={styles.timelineRow}>
            {([
              { num: 1, label: 'Shell (Upcoming)' },
              { num: 2, label: 'Announcements (Rules)' },
              { num: 3, label: 'Live Registration' },
              { num: 4, label: 'Logistics (Day Before)' }
            ] as const).map(p => (
              <button
                key={p.num}
                className={`${styles.phaseTab} ${activePhase === p.num ? styles.phaseTabActive : ''}`}
                onClick={() => setActivePhase(p.num)}
              >
                <span className={styles.phaseTabNum}>{p.num}</span>
                <span>{p.label}</span>
              </button>
            ))}
          </div>

          {saved && (
            <div className={styles.saveToast}>
              <Check size={18} /> Settings successfully saved! Redirecting...
            </div>
          )}

          <div className={styles.grid}>
            {/* Left Config Panel */}
            <div className={styles.leftCol}>
              
              {/* PHASE 1 */}
              {activePhase === 1 && (
                <section className={styles.card}>
                  <div className={styles.cardHeader}>
                    <Layers className={styles.iconHeader} size={22} />
                    <div>
                      <h2 className={styles.cardTitle}>Phase 1: The Initial Shell</h2>
                      <p className={styles.cardSubtitle}>Start your event draft. Create divisions to announce public rules.</p>
                    </div>
                  </div>

                  <div className={styles.sectionBody}>
                    <div className={styles.infoAlert}>
                      <Info size={16} />
                      <span>Registration form is default: collects Name, Phone, Email, Team name. Public page shows &quot;Save the Date&quot;.</span>
                    </div>

                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel}>Create Division to Announce Rules</label>
                      <button type="button" className={styles.btnActionPrimary} onClick={handleOpenCreateModal} style={{ width: 'fit-content' }}>
                        <Plus size={16} /> Create Division
                      </button>
                    </div>

                    {divisions.length > 0 && (
                      <div className={styles.divisionsList}>
                        <h4 style={{ marginBottom: 12 }}>Added Divisions:</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {divisions.map(d => (
                            <div key={d.id} className={styles.divisionSetupRow}>
                              <div>
                                <span className={styles.divPill} style={{ marginRight: 8 }}>{d.name}</span>
                                <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                                  ({d.formatTypeOnSand} • Roster {d.maxRosterSize} • Cap: {d.divisionTeamCap} teams • Fee: {d.registrationFee === 0 ? 'Free' : `${d.registrationFee} THB`})
                                </span>
                              </div>
                              <button className={styles.btnRemove} onClick={() => removeDivision(d.id)}>
                                <Trash2 size={15} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* PHASE 2 */}
              {activePhase === 2 && (
                <section className={styles.card}>
                  <div className={styles.cardHeader}>
                    <BookOpen className={styles.iconHeader} size={22} />
                    <div>
                      <h2 className={styles.cardTitle}>Phase 2: Rules &amp; Seeding Prep</h2>
                      <p className={styles.cardSubtitle}>Announce standard tournament rules. Customize player form questions before opening registration.</p>
                    </div>
                  </div>

                  <div className={styles.sectionBody}>
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel}>Custom Registration Form Builder</label>
                      <div className={styles.questionsList}>
                        {questions.map((q) => (
                          <div key={q.id} className={styles.questionItem}>
                            <span>{q.label} <code style={{ fontSize: 11 }}>({q.type})</code></span>
                            <button className={styles.btnRemove} onClick={() => removeQuestion(q.id)} disabled={questionsLocked}>
                              <Trash2 size={15} />
                            </button>
                          </div>
                        ))}
                      </div>

                      {!questionsLocked && (
                        <>
                          <div className={styles.builderRow} style={{ marginTop: 10 }}>
                            <input
                              type="text"
                              className={styles.input}
                              placeholder="Question text"
                              value={newQuestionLabel}
                              onChange={e => setNewQuestionLabel(e.target.value)}
                            />
                            <select
                              className={styles.select}
                              value={newQuestionType}
                              onChange={e => setNewQuestionType(e.target.value as 'text' | 'select' | 'checkbox')}
                            >
                              <option value="text">Short Text</option>
                              <option value="select">Dropdown Choice</option>
                            </select>
                          </div>
                          <button type="button" className={styles.btnAdd} onClick={addQuestion} style={{ marginTop: 10 }}>
                            <Plus size={16} /> Add field
                          </button>
                        </>
                      )}
                    </div>

                    <hr className={styles.divider} />

                    <div className={styles.guardrailBox}>
                      <p className={styles.guardLabel}>🛡️ Setup Guardrail</p>
                      <p className={styles.guardText}>Lock form fields to launch player registration.</p>
                      <button
                        type="button"
                        className={styles.btnActionPrimary}
                        onClick={lockQuestions}
                        disabled={questionsLocked}
                      >
                        {questionsLocked ? 'Questions Locked ✓' : 'Lock Questions & Announce'}
                      </button>
                    </div>
                  </div>
                </section>
              )}

              {/* PHASE 3 */}
              {activePhase === 3 && (
                <section className={styles.card}>
                  <div className={styles.cardHeader}>
                    <ListPlus className={styles.iconHeader} size={22} />
                    <div>
                      <h2 className={styles.cardTitle}>Phase 3: Live Registration</h2>
                      <p className={styles.cardSubtitle}>Simulate team entries. Verify payment clocks and unique phone restrictions.</p>
                    </div>
                  </div>

                  <div className={styles.sectionBody}>
                    <div className={styles.regHeaderArea}>
                      <h3>Simulate Team Registration</h3>
                      <button type="button" className={styles.btnExpiryClear} onClick={clearExpiredAndPromote}>
                        ⏳ Clean Unpaid &amp; Promote Waitlist (24h Expiry)
                      </button>
                    </div>

                    {regError && <div className={styles.simRegError}>{regError}</div>}

                    <form onSubmit={simulateRegistration} className={styles.simRegForm}>
                      <div className={styles.twoCol}>
                        <input
                          type="text"
                          className={styles.input}
                          placeholder="Team Name (e.g. Miller/Smith)"
                          required
                          value={regTeamName}
                          onChange={e => setRegTeamName(e.target.value)}
                        />
                        <input
                          type="tel"
                          className={styles.input}
                          placeholder="Phone Number (Unique)"
                          required
                          value={regPhone}
                          onChange={e => setRegPhone(e.target.value)}
                        />
                      </div>
                      <div className={styles.builderRow} style={{ marginTop: 10 }}>
                        <input
                          type="email"
                          className={styles.input}
                          placeholder="Email Address"
                          required
                          value={regEmail}
                          onChange={e => setRegEmail(e.target.value)}
                        />
                        <button type="submit" className={styles.btnActionPrimary}>
                          Submit Registration
                        </button>
                      </div>
                    </form>

                    <h4 className={styles.tableHeading}>Registered Teams ({teams.length}/6 seats filled)</h4>
                    <div className={styles.teamsListSim}>
                      {teams.map(t => (
                        <div key={t.id} className={styles.teamSimRow}>
                          <div>
                            <span className={styles.teamSimName}>{t.name}</span>
                            <span className={styles.teamSimPhone}>📞 {t.phone}</span>
                            <span className={`${styles.statusLabelSim} ${t.paymentCleared ? styles.paidSim : styles.unpaidSim}`}>
                              {t.paymentCleared ? 'Confirmed' : 'Unpaid (24h clock)'}
                            </span>
                          </div>
                          {!t.paymentCleared && (
                            <button type="button" className={styles.btnPaySim} onClick={() => markPaid(t.id)}>
                              Confirm Payment
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    {waitlist.length > 0 && (
                      <>
                        <h4 className={styles.tableHeading}>Waitlisted Teams</h4>
                        <div className={styles.teamsListSim}>
                          {waitlist.map(w => (
                            <div key={w.id} className={styles.teamSimRow}>
                              <div>
                                <span className={styles.teamSimName}>{w.name}</span>
                                <span className={styles.teamSimPhone}>📞 {w.phone}</span>
                                <span className={styles.waitlistLabelSim}>Waitlist</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    <hr className={styles.divider} />
                    <button
                      type="button"
                      className={styles.btnActionPrimary}
                      onClick={() => setActivePhase(4)}
                      style={{ alignSelf: 'flex-end' }}
                    >
                      Advance to Logistics (Day Before) <ChevronRight size={16} />
                    </button>
                  </div>
                </section>
              )}

              {/* PHASE 4 */}
              {activePhase === 4 && (
                <section className={styles.card}>
                  <div className={styles.cardHeader}>
                    <Settings className={styles.iconHeader} size={22} />
                    <div>
                      <h2 className={styles.cardTitle}>Phase 4: Logistics Seeding (The Day Before)</h2>
                      <p className={styles.cardSubtitle}>Setup courts, drag manual rankings, and run serpentine serpentine/snake pool allocation math.</p>
                    </div>
                  </div>

                  <div className={styles.sectionBody}>
                    <h3 className={styles.subSectionTitle}>1. Resource Setup (Courts)</h3>
                    <div className={styles.courtsWrap}>
                      <div className={styles.courtsGrid}>
                        {courts.map(c => (
                          <div key={c} className={styles.courtTag}>
                            <span>{c}</span>
                            <button type="button" onClick={() => removeCourt(c)}>×</button>
                          </div>
                        ))}
                      </div>
                      <div className={styles.builderRow} style={{ marginTop: 10 }}>
                        <input
                          type="text"
                          className={styles.input}
                          placeholder="Court Name (e.g. Court 3)"
                          value={newCourtName}
                          onChange={e => setNewCourtName(e.target.value)}
                        />
                        <button type="button" className={styles.btnActionPrimary} onClick={addCourt}>
                          Add Court
                        </button>
                      </div>
                    </div>

                    <hr className={styles.divider} />

                    <h3 className={styles.subSectionTitle}>2. Strict Seeding Order (Move to rank)</h3>
                    <p className={styles.subSectionDesc}>Rank teams manually prior to generating brackets.</p>
                    <div className={styles.seedingList}>
                      {teams.map((t, idx) => (
                        <div key={t.id} className={styles.seedItem}>
                          <span className={styles.seedNumber}>#{idx + 1}</span>
                          <span className={styles.seedName}>{t.name}</span>
                          <div className={styles.seedArrows}>
                            <button type="button" onClick={() => moveSeed(idx, 'up')} disabled={idx === 0}><ArrowUp size={14} /></button>
                            <button type="button" onClick={() => moveSeed(idx, 'down')} disabled={idx === teams.length - 1}><ArrowDown size={14} /></button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      className={styles.btnGenerateSchedule}
                      onClick={() => runSerpentineSerpents(teams)}
                    >
                      🏐 GENERATE SCHEDULE &amp; BRACKETS (Snake Pool Distribution)
                    </button>

                    {scheduleGenerated && (
                      <div className={styles.simPoolsGrid}>
                        <div className={styles.simPool}>
                          <h4>Pool A (Seeds: 1, 4, 5)</h4>
                          {poolA.map((t, idx) => (
                            <div key={t.id} className={styles.poolRowItem}>
                              <span>{t.name} <code style={{ fontSize: 11 }}>(Seed #{t.seed})</code></span>
                              <button type="button" onClick={() => swapPoolTeams(t.id, 'B')}>Move to B</button>
                            </div>
                          ))}
                        </div>
                        <div className={styles.simPool}>
                          <h4>Pool B (Seeds: 2, 3, 6)</h4>
                          {poolB.map((t, idx) => (
                            <div key={t.id} className={styles.poolRowItem}>
                              <span>{t.name} <code style={{ fontSize: 11 }}>(Seed #{t.seed})</code></span>
                              <button type="button" onClick={() => swapPoolTeams(t.id, 'A')}>Move to A</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              )}

            </div>

            {/* Right Live Simulator Window */}
            <div className={styles.rightCol}>
              <div className={styles.previewSticky}>
                <div className={styles.previewTitleRow}>
                  <Sparkles size={16} />
                  <span>PUBLIC PLAYER PAGE PREVIEW</span>
                </div>

                <div className={styles.mobileSimScreen}>
                  <div className={styles.simHeader}>
                    <div className={styles.simLogo}>🏐 Live Bracket</div>
                  </div>

                  <div className={styles.simContent}>
                    <div className={styles.simStatusRow}>
                      <span className={styles.simRegPill}>
                        {activePhase === 1 ? 'Save the Date' :
                         activePhase === 2 ? 'Registration Date Pending' :
                         activePhase === 3 ? (teams.length >= 6 ? 'Registration Full' : 'Registration: Open Now') :
                         'Registration: Closed'}
                      </span>
                    </div>

                    <h3 className={styles.simTitle}>Bang Niang Beach Classic 2025</h3>
                    <p className={styles.simVenue}>📍 Memories Beach, Khao Lak</p>

                    <div className={styles.simSection}>
                      <h4 className={styles.simSecTitle}>Player Registration Action Button</h4>
                      {activePhase === 1 && (
                        <button className={styles.simCtaDisabled} disabled>
                          Registration Date Pending (Watchlist Enabled ⭐)
                        </button>
                      )}
                      {activePhase === 2 && (
                        <button className={styles.simCtaDisabled} disabled>
                          Registration Opens Soon (Watchlist Enabled ⭐)
                        </button>
                      )}
                      {activePhase === 3 && (
                        teams.length >= 6 ? (
                          <button className={styles.simCtaWaitlist}>
                            Join Waitlist (Navy outline style)
                          </button>
                        ) : (
                          <button className={styles.simCtaActive}>
                            Register Team → (Active Orange style)
                          </button>
                        )
                      )}
                      {activePhase === 4 && (
                        <button className={styles.simCtaClosed} disabled>
                          Registration Closed (Dead Gray style)
                        </button>
                      )}
                    </div>



                    {scheduleGenerated && (
                      <div className={styles.simSection}>
                        <h4 className={styles.simSecTitle}>Pool Group Serpentine Seeds</h4>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>
                          <strong>Pool A:</strong> {poolA.map(t => `${t.name} (Seed #${t.seed})`).join(', ')} <br />
                          <strong>Pool B:</strong> {poolB.map(t => `${t.name} (Seed #${t.seed})`).join(', ')}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </main>

      {/* ── CREATE DIVISION MODAL ─────────────────────────────────── */}
      {showModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h3>Create New Division</h3>
              <button className={styles.modalCloseBtn} onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className={styles.modalBody}>
              {formError && (
                <div className={styles.modalFormError}>{formError}</div>
              )}

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
                  <span className={styles.fieldHint}>Flips the public button to &quot;Waitlist Full&quot;.</span>
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Format On-Sand *</label>
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
                  <span className={styles.fieldHint}>Dictates the match scoring engine.</span>
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

              {/* ── B. Staggered Timing & Fees ───────────────────── */}
              <p className={styles.modalSectionTitle}>Timing &amp; Fees</p>

              <div className={styles.twoCol}>
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
                <div className={styles.fieldGroup}>
                  <div className={styles.labelRow}>
                    <label className={styles.fieldLabel}>Registration Opens</label>
                    <button
                      type="button"
                      className={styles.openNowBtn}
                      onClick={() => setRegOpenDate(toLocalDatetimeValue(new Date()))}
                    >
                      Open now
                    </button>
                  </div>
                  <input
                    type="datetime-local"
                    className={styles.input}
                    value={regOpenDate}
                    onChange={e => setRegOpenDate(e.target.value)}
                  />
                  <span className={styles.fieldHint}>
                    {regOpenDate && new Date(regOpenDate) <= new Date()
                      ? 'Registration is open immediately.'
                      : 'Staggered window for this division only.'}
                  </span>
                </div>
              </div>

              {/* ── C. Rules & Formats ───────────────────────────── */}
              <p className={styles.modalSectionTitle}>Rules &amp; Formats</p>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Competition Format *</label>
                <div className={styles.selectorGroup}>
                  {([
                    { value: 'pool', label: 'Pool Play Only' },
                    { value: 'single', label: 'Single Elimination' },
                    { value: 'double', label: 'Double Elimination' },
                    { value: 'hybrid', label: 'Hybrid' },
                  ] as const).map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`${styles.selectorBtn} ${compFormat === opt.value ? styles.selectorBtnActive : ''}`}
                      onClick={() => setCompFormat(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.fieldGroup} style={{ marginTop: 12 }}>
                <label className={styles.fieldLabel}>Scoring Rules</label>
                <div className={styles.scoringMatrix}>
                  <div className={styles.scoringRow}>
                    <span className={styles.scoringRowLabel}>Match</span>
                    <label className={styles.scoringCell}>
                      <span>Best of</span>
                      <select
                        className={styles.scoringInput}
                        value={scoring.setsBestOf}
                        onChange={e => setScoring({ ...scoring, setsBestOf: parseInt(e.target.value) })}
                      >
                        <option value={1}>1</option>
                        <option value={3}>3</option>
                        <option value={5}>5</option>
                      </select>
                    </label>
                    <label className={styles.scoringCell}>
                      <input
                        type="checkbox"
                        checked={scoring.winBy2}
                        onChange={e => setScoring({ ...scoring, winBy2: e.target.checked })}
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
                        value={scoring.pointsPerSet}
                        onChange={e => setScoring({ ...scoring, pointsPerSet: parseInt(e.target.value) || 0 })}
                      />
                    </label>
                    <label className={styles.scoringCell}>
                      <span>Hard cap</span>
                      <input
                        type="number"
                        className={styles.scoringInput}
                        min={0}
                        placeholder="none"
                        value={scoring.hardCap || ''}
                        onChange={e => setScoring({ ...scoring, hardCap: parseInt(e.target.value) || 0 })}
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
                        value={scoring.decidingSetPoints}
                        onChange={e => setScoring({ ...scoring, decidingSetPoints: parseInt(e.target.value) || 0 })}
                      />
                    </label>
                  </div>
                </div>
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

              {/* ── Per-division Registration Questions ──────────── */}
              <p className={styles.modalSectionTitle}>Registration Questions</p>
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
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.btnGhost} onClick={() => setShowModal(false)}>Cancel</button>
              <button className={styles.btnActionPrimary} onClick={saveDivisionModal}>Create Division</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
