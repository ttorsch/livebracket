'use client';

import { useCallback, useEffect, useState } from 'react';
import { X, Pencil, Mail, MessageCircle, ShieldCheck, Lock, UserPlus, LogIn } from 'lucide-react';
import styles from './TeamCardModal.module.css';
import { Button } from './livebracket-ds';
import { supabase } from '@/lib/supabase';
import RosterFields, {
  type RosterPlayer, type RosterContact, type RosterTeamAnswers,
} from './registration/RosterFields';
import {
  isTeamField, presetAnswers, presetCustomBag, type RegField,
} from '../lib/registrationFields';

/* ── A registered team, opened from its card ──────────────────────
 *
 * Who is on the team, and — for the people actually on it — a way to fix
 * what the registration form got wrong. Names get typed in a hurry on a
 * phone at the beach, and until this existed the only way to correct one
 * was to message the organizer.
 *
 * The modal is one component with stages rather than four dialogs,
 * because it is one continuous act: you open a team, you say it is yours,
 * you change it. Splitting that across screens would lose the team you
 * started from.
 *
 *   view       who is on this team (everyone sees this)
 *   gate       "we'll send a code to t••••@gmail.com"
 *   code       the six digits
 *   edit       the registration form again, prefilled
 *   newEmail   confirming a *changed* contact address, at the new one
 *
 * Nothing here decides anything. The server re-answers "may you edit
 * this" on every request; this only decides what to draw.
 */

export interface TeamCardTarget {
  teamId: string;
  /** What the card already shows, so the modal opens with content. */
  teamName: string | null;
  players: { id: string; name: string }[];
  status: string;
}

type Stage = 'view' | 'gate' | 'code' | 'offer' | 'signIn' | 'edit' | 'newEmail';

interface ChannelOption { channel: 'email' | 'whatsapp'; hint: string }

interface EditableTeam {
  id: string;
  teamName: string | null;
  status: string;
  contactEmail: string | null;
  contactPhone: string | null;
  customFields: Record<string, unknown>;
  players: {
    id: string; name: string; shirtSize: string | null;
    customFields: Record<string, unknown>; userId: string | null;
  }[];
  division: {
    id: string; name: string; formatTypeOnSand: string;
    regFields: RegField[]; drawLocked: boolean;
  };
  tournament: { slug: string; title: string; cancelled: boolean };
}

interface AccessResponse {
  canEdit: boolean;
  via: 'account' | 'verified' | 'organizer' | null;
  rosterLocked?: boolean;
  channels: ChannelOption[];
  /* Present only for a visitor who got in with an emailed code and has no
     session — the one case where offering an account is both useful and
     free of a second confirmation email. */
  accountOffer?: { email: string } | null;
  contactless?: boolean;
  team?: EditableTeam;
}

export default function TeamCardModal({
  target, onClose, onSaved,
}: {
  target: TeamCardTarget | null;
  onClose: () => void;
  /** Lets the page redraw the card behind the modal after a save. */
  onSaved?: () => void;
}) {
  if (!target) return null;
  /* Keyed on the team so opening a second one starts from a blank modal
     rather than from the first one's answers — the same reason
     PlayerCardModal splits its door from its card. */
  return <Dialog key={target.teamId} target={target} onClose={onClose} onSaved={onSaved} />;
}

function Dialog({ target, onClose, onSaved }: {
  target: TeamCardTarget; onClose: () => void; onSaved?: () => void;
}) {
  const [stage, setStage] = useState<Stage>('view');
  const [access, setAccess] = useState<AccessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* Kept free of setState so the effect below can call it without
     scheduling a render from an effect body — the state lands in the
     promise callback instead, which is the same shape the page's avatar
     fetch uses. */
  const fetchAccess = useCallback(async (): Promise<AccessResponse> => {
    const res = await fetch(`/api/teams/${target.teamId}`);
    const data = (await res.json()) as AccessResponse & { error?: string };
    if (!res.ok) throw new Error(data.error ?? 'Could not load this team');
    return data;
  }, [target.teamId]);

  useEffect(() => {
    let cancelled = false;
    fetchAccess()
      .then((data) => { if (!cancelled) { setAccess(data); setLoading(false); } })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load this team');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [fetchAccess]);

  /* The same read, for after a code is confirmed or a save lands. Called
     from handlers, where setState is exactly the right thing to do. */
  const loadAccess = useCallback(async (): Promise<AccessResponse | null> => {
    try {
      const data = await fetchAccess();
      setAccess(data);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this team');
      return null;
    }
  }, [fetchAccess]);

  // Escape closes, and the page behind stops scrolling while this is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const startEditing = () => {
    setError(null);
    if (access?.canEdit) setStage('edit');
    else setStage('gate');
  };

  const heading = target.teamName?.trim() || playersLine(target.players);

  return (
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${heading} — team details`}
      >
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
          <X size={17} />
        </button>

        <header className={styles.header}>
          <h2 className={styles.teamName}>{heading}</h2>
          {access?.team?.division.name && (
            <p className={styles.division}>{access.team.division.name}</p>
          )}
          {target.status === 'waitlist' && <span className={styles.waitlist}>Waitlist</span>}
        </header>

        {error && <p className={styles.error} role="alert">{error}</p>}

        {stage === 'view' && (
          <ViewStage
            target={target}
            access={access}
            loading={loading}
            onEdit={startEditing}
          />
        )}

        {stage === 'gate' && access && (
          <GateStage
            teamId={target.teamId}
            channels={access.channels}
            contactless={Boolean(access.contactless)}
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            onSent={() => { setError(null); setStage('code'); }}
            onBack={() => { setError(null); setStage('view'); }}
          />
        )}

        {stage === 'code' && (
          <CodeStage
            title="Enter the code"
            blurb="We sent six digits to your team's contact address."
            submit={async (code) => {
              const res = await fetch(`/api/teams/${target.teamId}/verify/confirm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data?.error ?? 'That code is not right');
              const fresh = await loadAccess();
              if (!fresh?.canEdit) throw new Error('Confirmed, but this team still cannot be edited');
              setStage(fresh.accountOffer ? 'offer' : 'edit');
            }}
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            onBack={() => { setError(null); setStage('gate'); }}
          />
        )}

        {stage === 'offer' && access?.accountOffer && access.team && (
          <OfferStage
            teamId={target.teamId}
            email={access.accountOffer.email}
            players={access.team.players}
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            onExists={() => { setError(null); setStage('signIn'); }}
            onDone={async () => { await loadAccess(); onSaved?.(); setError(null); setStage('edit'); }}
            onSkip={() => { setError(null); setStage('edit'); }}
          />
        )}

        {stage === 'signIn' && access?.accountOffer && (
          <SignInStage
            email={access.accountOffer.email}
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            onDone={async () => { await loadAccess(); onSaved?.(); setError(null); setStage('edit'); }}
            onSkip={() => { setError(null); setStage('edit'); }}
          />
        )}

        {stage === 'edit' && access?.team && (
          <EditStage
            team={access.team}
            rosterLocked={Boolean(access.rosterLocked)}
            via={access.via}
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            onCancel={() => { setError(null); setStage('view'); }}
            onSaved={async (pendingEmail) => {
              await loadAccess();
              onSaved?.();
              if (pendingEmail) setStage('newEmail');
              else { setError(null); setStage('view'); }
            }}
          />
        )}

        {stage === 'newEmail' && (
          <CodeStage
            title="Confirm your new email"
            blurb="Everything else is saved. The new contact address takes effect once you enter the code we just sent to it."
            submit={async (code) => {
              const res = await fetch(`/api/teams/${target.teamId}/contact-email/confirm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data?.error ?? 'That code is not right');
              await loadAccess();
              setError(null);
              setStage('view');
            }}
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            /* Skipping leaves the old address in place, which is a real
               choice and not a failure — so it says so. */
            onBack={() => { setError(null); setStage('view'); }}
            backLabel="Later"
          />
        )}
      </div>
    </div>
  );
}

/* ── view ─────────────────────────────────────────────────────── */

function ViewStage({ target, access, loading, onEdit }: {
  target: TeamCardTarget;
  access: AccessResponse | null;
  loading: boolean;
  onEdit: () => void;
}) {
  const players = access?.team?.players ?? target.players;
  /* Always offered. Whether this is your team is a question only the
     server can answer, and the two ways it can be un-editable are better
     said in a sentence behind the button than by a button that is not
     there — a missing control reads as a bug. */
  return (
    <>
      <ul className={styles.players}>
        {players.map((p, i) => (
          <li key={p.id || i} className={styles.player}>{p.name}</li>
        ))}
      </ul>

      <footer className={styles.footer}>
        <Button variant="primary" fullWidth iconLeft={<Pencil size={16} />} onClick={onEdit} disabled={loading}>
          Edit team details
        </Button>
        {access?.via === 'organizer' && (
          <p className={styles.note}><ShieldCheck size={13} /> You run this tournament</p>
        )}
      </footer>
    </>
  );
}

/* ── gate ─────────────────────────────────────────────────────── */

function GateStage({ teamId, channels, contactless, busy, setBusy, setError, onSent, onBack }: {
  teamId: string;
  channels: ChannelOption[];
  contactless: boolean;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setError: (v: string | null) => void;
  onSent: () => void;
  onBack: () => void;
}) {
  const send = async (channel: 'email' | 'whatsapp') => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/teams/${teamId}/verify/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel }),
      });
      const data = await res.json();
      /* A cooldown means the code they need is already in their inbox, so
         it moves them forward rather than stopping them. */
      if (!res.ok && data?.reason !== 'cooldown') throw new Error(data?.error ?? 'Could not send the code');
      if (data?.reason === 'cooldown') setError(data.error);
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code');
    } finally {
      setBusy(false);
    }
  };

  if (contactless || channels.length === 0) {
    return (
      <div className={styles.stage}>
        <p className={styles.blurb}>
          {contactless
            ? 'This team registered without a contact address, so there is no way to confirm it from here. The tournament organizer can make the change for you.'
            : 'Confirming by code is not available right now. The tournament organizer can make the change for you.'}
        </p>
        <Button variant="general" fullWidth onClick={onBack}>Back</Button>
      </div>
    );
  }

  return (
    <div className={styles.stage}>
      <p className={styles.blurb}>
        Only the team can change these details. We&rsquo;ll send a code to the contact you
        registered with.
      </p>
      <div className={styles.channels}>
        {channels.map(({ channel, hint }) => (
          <button
            key={channel}
            type="button"
            className={styles.channel}
            onClick={() => void send(channel)}
            disabled={busy}
          >
            {channel === 'email' ? <Mail size={17} /> : <MessageCircle size={17} />}
            <span className={styles.channelText}>
              <span className={styles.channelLabel}>
                {channel === 'email' ? 'Email a code' : 'WhatsApp a code'}
              </span>
              <span className={styles.channelHint}>{hint}</span>
            </span>
          </button>
        ))}
      </div>
      <Button variant="general" fullWidth onClick={onBack} disabled={busy}>Cancel</Button>
    </div>
  );
}

/* ── code ─────────────────────────────────────────────────────── */

function CodeStage({ title, blurb, submit, busy, setBusy, setError, onBack, backLabel = 'Back' }: {
  title: string;
  blurb: string;
  submit: (code: string) => Promise<void>;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setError: (v: string | null) => void;
  onBack: () => void;
  backLabel?: string;
}) {
  const [code, setCode] = useState('');

  const go = async () => {
    if (busy || code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await submit(code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code is not right');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.stage}>
      <h3 className={styles.stageTitle}>{title}</h3>
      <p className={styles.blurb}>{blurb}</p>
      <input
        className={styles.codeInput}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onKeyDown={(e) => { if (e.key === 'Enter') void go(); }}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="000000"
        aria-label="Six-digit code"
        autoFocus
      />
      <Button variant="primary" fullWidth onClick={() => void go()} disabled={code.length !== 6} loading={busy}>
        Confirm
      </Button>
      <Button variant="general" fullWidth onClick={onBack} disabled={busy}>{backLabel}</Button>
    </div>
  );
}

/* ── offer an account ─────────────────────────────────────────── */

/* Signing in, then claiming, exactly as the login form does it. The
   account is already confirmed by the time this runs, so there is no
   inbox round trip between creating it and using it. */
async function signInAndClaim(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  /* Best-effort, like the login page: the session is real either way, and
     a failed claim only means the team shows up on the next sign-in. */
  await fetch('/api/auth/claim', { method: 'POST' }).catch(() => {});
}

function OfferStage({ teamId, email, players, busy, setBusy, setError, onExists, onDone, onSkip }: {
  teamId: string;
  email: string;
  players: EditableTeam['players'];
  busy: boolean;
  setBusy: (v: boolean) => void;
  setError: (v: string | null) => void;
  onExists: () => void;
  onDone: () => void | Promise<void>;
  onSkip: () => void;
}) {
  const [password, setPassword] = useState('');
  const [playerId, setPlayerId] = useState<string | null>(null);
  /* A slot already linked to an account belongs to that person; claiming
     it is what the invite flow is for, so it is shown and not offered. */
  const free = players.filter((p) => !p.userId);

  const create = async () => {
    if (busy || password.length < 6) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/teams/${teamId}/account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, playerId }),
      });
      const data = await res.json();
      if (res.status === 409 && data?.exists) { onExists(); return; }
      if (!res.ok) throw new Error(data?.error ?? 'Could not create the account');
      await signInAndClaim(email, password);
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.stage}>
      <h3 className={styles.stageTitle}>Want an account?</h3>
      <p className={styles.blurb}>
        You&rsquo;ve confirmed <strong>{email}</strong>. Set a password and this team joins your
        profile &mdash; next time you can edit it without waiting for a code.
      </p>

      {free.length > 0 && (
        <>
          <p className={styles.pickerLabel}>Which one is you?</p>
          <div className={styles.picker}>
            {free.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`${styles.pick} ${playerId === p.id ? styles.pickOn : ''}`}
                onClick={() => setPlayerId(playerId === p.id ? null : p.id)}
                disabled={busy}
              >
                {p.name}
              </button>
            ))}
          </div>
        </>
      )}

      <input
        className={styles.password}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void create(); }}
        placeholder="Choose a password"
        autoComplete="new-password"
        aria-label="Choose a password"
      />

      <Button
        variant="primary"
        fullWidth
        iconLeft={<UserPlus size={16} />}
        onClick={() => void create()}
        disabled={password.length < 6}
        loading={busy}
      >
        Create account
      </Button>
      {/* Equal weight on purpose. Editing without an account is the whole
          point of this flow, not the consolation prize. */}
      <Button variant="general" fullWidth onClick={onSkip} disabled={busy}>
        No thanks, just edit
      </Button>
    </div>
  );
}

function SignInStage({ email, busy, setBusy, setError, onDone, onSkip }: {
  email: string;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setError: (v: string | null) => void;
  onDone: () => void | Promise<void>;
  onSkip: () => void;
}) {
  const [password, setPassword] = useState('');

  const go = async () => {
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      await signInAndClaim(email, password);
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.stage}>
      <h3 className={styles.stageTitle}>You already have an account</h3>
      <p className={styles.blurb}>
        <strong>{email}</strong> is already registered. Sign in and this team joins your profile.
      </p>
      <input
        className={styles.password}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void go(); }}
        placeholder="Your password"
        autoComplete="current-password"
        aria-label="Your password"
        autoFocus
      />
      <Button variant="primary" fullWidth iconLeft={<LogIn size={16} />} onClick={() => void go()} disabled={!password} loading={busy}>
        Sign in
      </Button>
      <a className={styles.forgot} href="/forgot-password">Forgotten your password?</a>
      <Button variant="general" fullWidth onClick={onSkip} disabled={busy}>
        No thanks, just edit
      </Button>
    </div>
  );
}

/* ── edit ─────────────────────────────────────────────────────── */

function EditStage({ team, rosterLocked, via, busy, setBusy, setError, onCancel, onSaved }: {
  team: EditableTeam;
  rosterLocked: boolean;
  via: AccessResponse['via'];
  busy: boolean;
  setBusy: (v: boolean) => void;
  setError: (v: string | null) => void;
  onCancel: () => void;
  onSaved: (pendingEmail: boolean) => void | Promise<void>;
}) {
  const fields = team.division.regFields;
  const frozen = rosterLocked && via !== 'organizer';

  const [players, setPlayers] = useState<RosterPlayer[]>(() =>
    team.players.map((p) => ({
      name: p.name,
      shirtSize: p.shirtSize ?? '',
      ...presetAnswers(fields, p.customFields),
      userId: null,
    })),
  );
  const [contact, setContact] = useState<RosterContact>({
    email: team.contactEmail ?? '',
    phone: team.contactPhone ?? '',
  });
  const [answers, setAnswers] = useState<RosterTeamAnswers>({
    teamName: team.teamName ?? '',
    custom: Object.fromEntries(
      Object.entries(team.customFields).filter(([, v]) => typeof v === 'string'),
    ) as Record<string, string>,
  });

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/teams/${team.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamName: answers.teamName.trim(),
          teamCustom: answers.custom,
          contactEmail: contact.email.trim(),
          contactPhone: contact.phone.trim(),
          /* Omitted entirely when frozen, so a locked draw's roster is not
             even offered back to the server. */
          players: frozen ? undefined : players.map((p, i) => ({
            id: team.players[i].id,
            name: p.name.trim(),
            shirtSize: p.shirtSize || null,
            /* The stored bag wins for any key this form does not render,
               so an organizer's own question is not erased by a player
               fixing a spelling. */
            custom: {
              ...stringsOnly(team.players[i].customFields),
              ...presetCustomBag(fields, p),
            },
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Could not save');
      await onSaved(Boolean(data?.pendingEmail));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.stage}>
      {frozen && (
        <p className={styles.locked}>
          <Lock size={13} />
          The draw is locked, so the roster is fixed. You can still update your contact details —
          ask the organizer to change who is playing.
        </p>
      )}

      <div className={styles.form}>
        <RosterFields
          players={players}
          onPlayerChange={(index, patch) =>
            setPlayers((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))
          }
          contact={contact}
          onContactChange={(patch) => setContact((prev) => ({ ...prev, ...patch }))}
          team={answers}
          onTeamChange={(patch) => setAnswers((prev) => ({ ...prev, ...patch }))}
          fields={frozen ? fields.filter(isTeamField) : fields}
          required={{ name: true, contact: true }}
          signedIn={via === 'account' || via === 'organizer'}
        />
      </div>

      <Button variant="primary" fullWidth onClick={() => void save()} loading={busy}>Save changes</Button>
      <Button variant="general" fullWidth onClick={onCancel} disabled={busy}>Cancel</Button>
    </div>
  );
}

const stringsOnly = (bag: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(bag).filter(([, v]) => typeof v === 'string')) as Record<string, string>;

const playersLine = (players: { name: string }[]) =>
  players.map((p) => p.name.split(' ')[0]).join(' / ') || 'Team';
