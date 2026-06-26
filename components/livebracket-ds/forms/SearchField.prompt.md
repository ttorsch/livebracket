**Forms** — input controls for filtering and search.

```jsx
<SearchField placeholder="Search tournaments" value={q} onChange={e => setQ(e.target.value)} />

<SegmentedControl
  options={["Latest", "Starting Soon", { label: "Add Favorite", value: "fav", icon: <Icon name="star" size={18} /> }]}
  value={tab}
  onChange={setTab}
/>
```

- **SearchField** — pill input, leading magnifier + trailing mic (toggle with `showMic`).
- **SegmentedControl** — tab selector; selected option gets a white pill. Options accept an optional `icon`.
