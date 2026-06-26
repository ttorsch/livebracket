**MatchCard** — a single bracket match: round label + two team rows with avatars, per-set scores, and a large current score. The winning team is bold ink; the loser is muted.

```jsx
<MatchCard
  round="Men · Quarterfinals"
  live
  teamA={{ name: "Aroon / Niran", avatar: flagTH, sets: [21, 19], score: 2 }}
  teamB={{ name: "Lukas / Felix", avatar: flagDE, sets: [18, 21], score: 1 }}
/>
```

Pass `teamA` / `teamB` as `{ name, avatar, sets, score }`. Winner is computed from `score`. Composes the **Avatar** primitive.
