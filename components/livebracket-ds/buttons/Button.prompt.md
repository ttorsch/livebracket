**Button** — pill-shaped action button; the primary CTA pattern across Live Bracket (Register, See all division, Sign In).

```jsx
<Button variant="primary" onClick={register}>Register Team</Button>
<Button variant="secondary">Divisions</Button>
<Button variant="general" iconRight={<span>→</span>}>Sign In</Button>
<Button variant="arrow" aria-label="Next" />
<Button variant="primary" loading>Saving</Button>
```

Variants: `primary` (solid Sunset Orange + glow), `secondary` (soft coral tint, coral text), `general` (white, ink text), `arrow` (coral circle, icon-only). Sizes: `medium` (42px) and `small` (34px). Props: `loading`, `disabled`, `fullWidth`, `iconLeft`, `iconRight`. Always pill radius. Press scales to 0.96; focus shows a coral ring.
