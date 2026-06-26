'use client';

import React, { useState } from 'react';
import {
  GlassCard,
  Button,
  Logo,
  Avatar,
  Badge,
  DateChip,
  DivisionRing,
  LiveIndicator,
  PageControl,
  SearchField,
  SegmentedControl,
  Icon,
  MatchCard
} from '@/components/livebracket-ds';

// Mock tournaments data matching design system spec
const TOURNAMENTS = [
  {
    id: "khao-lak-open",
    name: "Khao Lak Open 2027",
    location: "Khao Lak, Phang Nga, Thailand",
    start: "Apr 1, 2026",
    end: "Apr 6, 2026",
    live: true,
    poster: "/images/livebracket/memories-beach-poster.png",
    divisions: [
      { label: "Men", filled: "19/24" },
      { label: "Women", filled: "21/24" },
    ],
    more: 4,
    matches: [
      { round: "Men · Quarterfinals", live: true,
        teamA: { name: "Aroon / Niran", sets: [21, 19], score: 2 },
        teamB: { name: "Lukas / Felix", sets: [18, 21], score: 1 } },
      { round: "Men · Quarterfinals",
        teamA: { name: "Chai / Wira", sets: [21, 21], score: 2 },
        teamB: { name: "Diego / Marco", sets: [17, 14], score: 0 } },
      { round: "Women · Semifinals",
        teamA: { name: "Mali / Som", sets: [21, 23], score: 2 },
        teamB: { name: "Ana / Júlia", sets: [19, 21], score: 1 } },
      { round: "Women · Semifinals", live: true,
        teamA: { name: "Nok / Ploy", sets: [15, 12], score: 0 },
        teamB: { name: "Emma / Sara", sets: [21, 18], score: 1 } },
    ],
  },
  {
    id: "phuket-classic",
    name: "Phuket Sunset Classic",
    location: "Patong Beach, Phuket, Thailand",
    start: "May 8, 2026",
    end: "May 10, 2026",
    live: false,
    poster: null,
    divisions: [
      { label: "Men", filled: "12/16" },
      { label: "Mixed", filled: "8/16" },
    ],
    more: 2,
    matches: [],
  },
  {
    id: "samui-shootout",
    name: "Koh Samui Shootout",
    location: "Chaweng Beach, Surat Thani, Thailand",
    start: "Jun 20, 2026",
    end: "Jun 22, 2026",
    live: false,
    poster: null,
    divisions: [
      { label: "Women", filled: "6/12" },
    ],
    more: 1,
    matches: [],
  },
];

// Helper PhotoBackdrop to contain the visual spec
function PhotoBackdrop({ children, dim = true }: { children: React.ReactNode; dim?: boolean }) {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 520, overflow: "hidden", borderRadius: "var(--radius-xl)" }}>
      <div style={{
        position: "absolute", inset: 0,
        background: `url("/images/Hero.jpg") center/cover no-repeat`,
      }} />
      {dim && <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(10,16,24,0.35) 0%, rgba(10,16,24,0.15) 30%, rgba(10,16,24,0.20) 100%)" }} />}
      <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column" }}>{children}</div>
    </div>
  );
}

// TopBar component
function TopBar({ onHome, user = "Aroon K." }: { onHome: () => void; user?: string }) {
  return (
    <header style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "12px 20px",
      borderBottom: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(20,24,30,0.15)",
      backdropFilter: "blur(8px)",
    }}>
      <button onClick={onHome} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
        <Logo variant="lockup" size={26} color="#fff" />
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "#fff", fontWeight: 500 }}>{user}</span>
        <Avatar name={user} size={28} />
      </div>
    </header>
  );
}

// Back Button helper
function BackBtn({ onBack }: { onBack: () => void }) {
  return (
    <button onClick={onBack} style={{
      display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.92)",
      border: "none", borderRadius: "var(--radius-pill)", padding: "6px 12px 6px 8px", cursor: "pointer",
      fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--text-primary)", fontWeight: 700,
      boxShadow: "var(--shadow-card)", transition: "transform var(--duration-fast), background var(--duration-base)",
    }}
    onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.95)'; }}
    onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
    onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
    >
      <span style={{ transform: "rotate(180deg)", display: "inline-flex" }}><Icon name="arrowRight" size={14} /></span> Back
    </button>
  );
}

// Login Screen
function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");

  const field = (label: string, value: string, set: (v: string) => void, type: string, ph: string) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontFamily: "var(--font-text)", fontWeight: 700, fontSize: 12, color: "var(--text-primary)" }}>{label}</span>
      <input type={type} value={value} onChange={(e) => set(e.target.value)} placeholder={ph}
        style={{ height: 38, borderRadius: "var(--radius-md)", border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.55)", padding: "0 12px", fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--text-primary)", outline: "none", boxSizing: "border-box" }} />
    </label>
  );

  return (
    <PhotoBackdrop dim={true}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <GlassCard tone="light" radius="2xl" padding={24} elevation="deep" style={{ width: 300 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, marginBottom: 14 }}>
            <Logo variant="mark" size={38} />
            <h2 className="lb-h2" style={{ marginTop: 2, fontSize: 18, textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 'bold' }}>Welcome back</h2>
            <p className="lb-body" style={{ textAlign: "center", fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>Sign in to follow brackets live.</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {field("Email", email, setEmail, "email", "you@email.com")}
            {field("Password", pw, setPw, "password", "••••••••")}
            <Button variant="primary" fullWidth onClick={onLogin} style={{ marginTop: 4, height: 36 }}>Sign In</Button>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 10, justifyContent: 'center', margin: '2px 0' }}>
              <div style={{ width: 60, height: 1, background: "var(--border-hairline)" }} /> or <div style={{ width: 60, height: 1, background: "var(--border-hairline)" }} />
            </div>
            <Button variant="general" fullWidth onClick={onLogin} style={{ height: 36 }}>Continue with Apple</Button>
            <p style={{ textAlign: "center", fontFamily: "var(--font-text)", fontSize: 11, color: "var(--text-secondary)", margin: "4px 0 0" }}>
              New here? <a href="#" onClick={(e) => { e.preventDefault(); onLogin(); }} style={{ color: "var(--text-link)", fontWeight: 700, textDecoration: "none" }}>Create account</a>
            </p>
          </div>
        </GlassCard>
      </div>
    </PhotoBackdrop>
  );
}

// Listing Screen
function ListingScreen({ onOpen, onHome }: { onOpen: (t: typeof TOURNAMENTS[0]) => void; onHome: () => void }) {
  const [tab, setTab] = useState("Latest");
  const [q, setQ] = useState("");
  const list = TOURNAMENTS.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <PhotoBackdrop>
      <TopBar onHome={onHome} />
      <div style={{ flex: 1, width: "100%", maxWidth: 640, margin: "0 auto", padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: 12, height: "calc(100% - 55px)", boxSizing: "border-box" }}>
        <SearchField placeholder="Search tournaments" value={q} onChange={(e) => setQ(e.target.value)} style={{ height: 42 }} />
        <SegmentedControl value={tab} onChange={setTab}
          options={["Latest", "Starting Soon", { label: "Add Favorite", value: "fav", icon: <Icon name="star" size={13} /> }]}
          style={{ padding: 2 }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 10, overflowY: "auto", flex: 1, minHeight: 0, paddingBottom: 4 }}>
          {list.map((t) => (
            <GlassCard key={t.id} tone="light" radius="xl" padding={0} elevation="glass"
              style={{ display: "flex", overflow: "hidden", cursor: "pointer", transition: 'transform var(--duration-fast)' }}
              onClick={() => onOpen(t)}
              onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.98)'; }}
              onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
              >
              <div style={{
                width: 100, flexShrink: 0, alignSelf: "stretch", margin: 8, borderRadius: "var(--radius-md)",
                background: t.poster
                  ? `var(--sand-100) url("${t.poster}") center/cover no-repeat`
                  : "linear-gradient(150deg, var(--coral-400), var(--coral-600))",
                display: "flex", alignItems: "flex-end", padding: 8, boxSizing: "border-box",
                minHeight: 100,
              }}>
                {!t.poster && <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 12, color: "#fff" }}>{t.name.split(" ")[0]}</span>}
              </div>
              <div style={{ flex: 1, padding: "8px 10px 8px 0", display: "flex", flexDirection: "column", gap: 4, justifyContent: 'center' }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontFamily: "var(--font-ui)", fontSize: 10, color: "var(--text-secondary)" }}>
                    <Icon name="location" size={10} color="var(--color-primary)" /> {t.location.split(",")[0]}
                  </span>
                  {t.live && <Badge variant="live" style={{ padding: '3px 6px' }}>Live</Badge>}
                </div>
                <h3 className="lb-h3" style={{ fontSize: 13, fontFamily: 'var(--font-display)', margin: 0, fontWeight: 'bold' }}>{t.name}</h3>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <DateChip style={{ padding: '2px 6px', fontSize: 10 }}>{t.start.split(",")[0]}</DateChip>
                  <span style={{ color: "var(--text-muted)", fontSize: 10 }}>to</span>
                  <DateChip style={{ padding: '2px 6px', fontSize: 10 }}>{t.end.split(",")[0]}</DateChip>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
                  {t.divisions.map((d) => (
                    <DivisionRing key={d.label} value={d.filled} label={d.label} size={22} style={{ gap: 2 }} />
                  ))}
                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 9, color: "var(--text-primary)", lineHeight: 1.0 }}>+{t.more} more<br/>division</span>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      </div>
    </PhotoBackdrop>
  );
}

// Detail Screen
function DetailScreen({ t, onBack, onSeeAll, onHome }: { t: typeof TOURNAMENTS[0]; onBack: () => void; onSeeAll: () => void; onHome: () => void }) {
  const [page, setPage] = useState(0);
  const matches = t.matches || [];
  const visible = matches.slice(page * 2, page * 2 + 2);
  const pages = Math.max(1, Math.ceil(matches.length / 2));

  return (
    <PhotoBackdrop>
      <TopBar onHome={onHome} />
      <div style={{ position: "absolute", left: 12, top: 68, zIndex: 10 }}><BackBtn onBack={onBack} /></div>
      <div style={{ flex: 1, width: "100%", maxWidth: 460, margin: "0 auto", padding: "30px 12px 12px", display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" }}>
        <GlassCard tone="light" radius="2xl" padding={18} elevation="deep" style={{ width: "100%" }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {t.live ? <LiveIndicator label="Live Now" size={8} style={{ fontSize: 12 }} /> : <Badge variant="status">Upcoming</Badge>}
          </div>
          <h2 className="lb-h2" style={{ marginTop: 8, fontSize: 18, fontFamily: 'var(--font-display)', fontWeight: 'bold' }}>{t.name}</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
            <DateChip style={{ padding: '3px 8px', fontSize: 11 }}>{t.start}</DateChip>
            <span style={{ color: "var(--text-muted)", fontSize: 11 }}>to</span>
            <DateChip style={{ padding: '3px 8px', fontSize: 11 }}>{t.end}</DateChip>
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6, fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--text-secondary)" }}>
            <Icon name="location" size={12} color="var(--color-primary)" /> {t.location}
          </div>

          {matches.length > 0 ? (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {visible.map((m, i) => <MatchCard key={i} {...m} style={{ padding: 12, gap: 10 }} />)}
              <div style={{ display: "flex", justifyContent: "center", marginTop: 2 }}>
                <PageControl count={pages} active={page} onChange={setPage} />
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 12, padding: 14, textAlign: "center", borderRadius: "var(--radius-lg)", background: "rgba(255,255,255,0.4)", color: "var(--text-muted)", fontFamily: "var(--font-text)", fontSize: 11 }}>
              Bracket opens when registration closes.
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
            <Button variant="primary" onClick={onSeeAll} style={{ height: 36, fontSize: 13 }} iconRight={<span style={{ display: "inline-flex" }}><Icon name="arrowRight" size={13} /></span>}>See all divisions</Button>
          </div>
        </GlassCard>
      </div>
    </PhotoBackdrop>
  );
}

// Bracket Screen
function BracketScreen({ t, onBack, onHome }: { t: typeof TOURNAMENTS[0]; onBack: () => void; onHome: () => void }) {
  const [div, setDiv] = useState("Men");

  const rounds = [
    { name: "Quarterfinals", matches: [
      { teamA: { name: "Aroon / Niran", sets: [21,19], score: 2 }, teamB: { name: "Lukas / Felix", sets: [18,21], score: 1 }, live: true },
      { teamA: { name: "Chai / Wira", sets: [21,21], score: 2 }, teamB: { name: "Diego / Marco", sets: [17,14], score: 0 } },
      { teamA: { name: "Tem / Boon", sets: [19,21], score: 1 }, teamB: { name: "Kai / Jonas", sets: [21,23], score: 2 } },
      { teamA: { name: "Rit / Som", sets: [21,21], score: 2 }, teamB: { name: "Leo / Pax", sets: [15,18], score: 0 } },
    ]},
    { name: "Semifinals", matches: [
      { teamA: { name: "Aroon / Niran", sets: [21], score: 1 }, teamB: { name: "Chai / Wira", sets: [18], score: 0 }, live: true },
      { teamA: { name: "Kai / Jonas", score: 0 }, teamB: { name: "Rit / Som", score: 0 } },
    ]},
    { name: "Final", matches: [
      { teamA: { name: "TBD" }, teamB: { name: "TBD" } },
    ]},
  ];

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "var(--surface-app)", overflow: "hidden", display: "flex", flexDirection: "column", borderRadius: "var(--radius-xl)" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--border-hairline)", background: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={onBack} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--gray-100)", border: "none", borderRadius: "var(--radius-pill)", padding: "5px 10px 5px 6px", cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--text-primary)", fontWeight: 700 }}>
            <span style={{ transform: "rotate(180deg)", display: "inline-flex" }}><Icon name="arrowRight" size={12} /></span> Back
          </button>
          <div>
            <div style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>{t.location.split(",")[0]}</div>
            <h3 className="lb-h3" style={{ fontSize: 12, fontFamily: 'var(--font-display)', margin: 0, fontWeight: 'bold' }}>{t.name} · Bracket</h3>
          </div>
        </div>
        <button onClick={onHome} style={{ background: "none", border: "none", cursor: "pointer" }}><Logo variant="mark" size={24} /></button>
      </header>

      <div style={{ padding: "8px 16px 0" }}>
        <SegmentedControl value={div} onChange={setDiv} options={["Men", "Women", "Mixed"]} style={{ width: '100%', padding: 2 }} />
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "12px 16px 16px" }}>
        <div style={{ display: "flex", gap: 14, alignItems: "stretch", minWidth: "max-content", height: "100%" }}>
          {rounds.map((r) => (
            <div key={r.name} style={{ display: "flex", flexDirection: "column", gap: 10, justifyContent: "space-around", width: 190 }}>
              <div style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'center', letterSpacing: '0.05em', fontWeight: 700 }}>{r.name}</div>
              {r.matches.map((m, i) => <MatchCard key={i} {...m} style={{ padding: 10, gap: 8 }} />)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Main Simulator container export
export function Simulator() {
  const [screen, setScreen] = useState<"login" | "listing" | "detail" | "bracket">("login");
  const [active, setActive] = useState(TOURNAMENTS[0]);

  const goHome = () => setScreen("listing");

  return (
    <div style={{ width: "100%", height: 520, position: "relative" }}>
      {screen === "login" && <LoginScreen onLogin={() => setScreen("listing")} />}
      {screen === "listing" && (
        <ListingScreen
          onHome={goHome}
          onOpen={(t) => { setActive(t); setScreen("detail"); }}
        />
      )}
      {screen === "detail" && (
        <DetailScreen
          t={active}
          onHome={goHome}
          onBack={() => setScreen("listing")}
          onSeeAll={() => setScreen("bracket")}
        />
      )}
      {screen === "bracket" && (
        <BracketScreen t={active} onHome={goHome} onBack={() => setScreen("detail")} />
      )}
    </div>
  );
}
