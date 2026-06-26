**Logo** — Live Bracket identity: the coral disc + stepped-bracket glyph, optionally locked up with the "LIVE BRACKET" wordmark (Inter).

```jsx
<Logo variant="lockup" size={40} />          {/* mark + wordmark */}
<Logo variant="mark" size={48} />            {/* coral disc mark only */}
<Logo variant="wordmark" color="#fff" />     {/* text only, e.g. on photo header */}
```

The mark is inlined SVG (works from any path) and uses `var(--color-primary)` for the disc. On dark/photo backgrounds use the white wordmark color. A standalone `assets/logomark.svg` is also available.
