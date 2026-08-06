import { MatchCard } from 'livebracket-ds';

export function Live() {
  return (
    <div style={{ padding: 20 }}>
      <MatchCard
        round="Men · Quarterfinals"
        live
        teamA={{ name: 'Aroon / Niran', sets: [21, 19], score: 2 }}
        teamB={{ name: 'Lukas / Felix', sets: [18, 21], score: 1 }}
      />
    </div>
  );
}

export function Completed() {
  return (
    <div style={{ padding: 20 }}>
      <MatchCard
        round="Women · Semifinals"
        teamA={{ name: 'Mali / Som', sets: [21, 21], score: 2 }}
        teamB={{ name: 'Ana / Júlia', sets: [17, 15], score: 0 }}
      />
    </div>
  );
}
