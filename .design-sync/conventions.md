## Live Bracket design system — build conventions

No provider or theme wrapper is required. Every component self-styles with inline `style` props that read CSS custom properties already defined globally — just import components from `livebracket-ds` and use them.

### Styling idiom: CSS custom properties, not utility classes

Components carry their own look via `var(--token-name)`, not classNames. When you need to style your OWN layout glue (page background, spacing, non-component text), reach for these tokens directly — never hardcode a hex value:

- **Color**: `--color-primary` (coral #EB6F43, brand accent), `--color-primary-hover`, `--color-primary-soft` (secondary-button fill), `--surface-app` (warm sand-cream page bg), `--surface-card` (white), `--text-primary` / `--text-secondary` / `--text-muted` (cool-navy ink scale), `--status-live` (red dot), `--status-highlight` (amber).
- **Radius**: `--radius-sm` (8), `--radius-md` (12), `--radius-lg` (20, pill buttons/highlight chips), `--radius-xl` (24, cards), `--radius-2xl` (34, liquid-glass panels), `--radius-pill` (999).
- **Shadow**: `--shadow-card` (ambient card lift), `--shadow-primary` (coral button glow), plus the liquid-glass elevations used by `GlassCard`.
- **Spacing**: 8px base scale, `--space-1` (4) through `--space-16` (64).
- **Fonts**: `--font-display` (Space Grotesk — headings, scores, titles), `--font-text` (DM Sans — body/UI), `--font-ui` (Inter, falls back to system-ui — wordmark only).

### One real exception: typography helper classes

Free-standing text (anything not inside a component) uses these classes from `styles.css` rather than raw `font-*` CSS — they encode the brand's exact type scale:
`.lb-h1` (48/58 display), `.lb-h2` (28/36), `.lb-h3` (20/26), `.lb-body-lg` (16/24), `.lb-body` (14/20), `.lb-caption` (12/16, muted), `.lb-micro` (10/12 uppercase overline), `.lb-score` (36/40 tabular-nums, for match scores), `.lb-wordmark` (Inter, the LIVE BRACKET lockup label).

### Where the truth lives

`styles.css` is the single stylesheet — it pulls in every token and the compiled component CSS; link only this one file. Each component's `<Name>.d.ts` is its prop contract; `<Name>.prompt.md` has real usage examples.

### Idiomatic composition

```jsx
import { MatchCard, Badge, GlassCard } from 'livebracket-ds';

<GlassCard tone="dark" radius="2xl" elevation="deep">
  <Badge variant="live">Live</Badge>
  <h3 className="lb-h3" style={{ marginTop: 12, color: '#fff' }}>Night Finals</h3>
</GlassCard>

<MatchCard
  round="Men · Quarterfinals"
  live
  teamA={{ name: 'Aroon / Niran', sets: [21, 19], score: 2 }}
  teamB={{ name: 'Lukas / Felix', sets: [18, 21], score: 1 }}
/>
```

Brand voice for any copy you write alongside these components: direct, warm, second-person, no exclamation spam ("Register Team", "See all division", "Live Now"). Title Case for buttons/tabs/tournament names; sentence case for body copy; UPPERCASE reserved for the wordmark and micro/overline labels.
