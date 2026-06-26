**GlassCard** — the signature frosted "liquid glass" panel; use over the beach-photo backdrop for tournament detail cards, brackets, and floating sheets.

```jsx
<GlassCard tone="light" radius="2xl" padding={24}>
  <h2 className="lb-h2">Khao Lak Open 2027</h2>
</GlassCard>
<GlassCard tone="dark" elevation="deep">…</GlassCard>
```

`tone`: light (default) or dark. `radius`: lg/xl/2xl/3xl. `elevation`: glass / deep / none. Renders `backdrop-filter: blur(18px) saturate(150%)` with a white rim and deep floating shadow.

**Card** — opaque warm-white container with soft ambient shadow for everyday rows and panels. `interactive` adds a hover lift.
