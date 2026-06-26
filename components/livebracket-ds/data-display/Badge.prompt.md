**Data display** — small status & metadata atoms for tournament UIs.

```jsx
<Badge variant="live">Live</Badge>
<Badge variant="highlight">Featured</Badge>
<LiveIndicator label="Live Now" />
<DateChip>Apr 3, 2026</DateChip>
<Avatar name="Aroon K." size={38} />
<DivisionRing value="19/24" label="Men" />
<PageControl count={3} active={0} onChange={setPage} />
```

- **Badge** — pill label: `live` (coral + dot), `highlight` (amber), `status` (neutral), `outline`.
- **LiveIndicator** — pulsing red dot + label for active events.
- **DateChip** — neutral pill for a date/time; pair two around a "to".
- **Avatar** — circular image / initials / placeholder.
- **DivisionRing** — circular slot count ("19/24") with optional label; `filled` for solid coral.
- **PageControl** — dot pagination for carousels.
