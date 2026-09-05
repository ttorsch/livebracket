import React from "react";

/**
 * Live Bracket — Badge
 *
 * Two families, one component.
 *
 * `status` is where a tournament is up to — announced, open, live, over.
 * That is not a chip: it is a line of coloured uppercase text that sits
 * above the name of the thing it describes, so the same word reads the same
 * way on a homepage card, a tournament hero and an organizer's row. Only
 * "live" moves, and only its dot.
 *
 * `variant` is everything else — a division's operational state, a team's
 * seat, a court's code. Those stay filled pills: they sit inside dense rows
 * where the chip is what separates them from the copy around them.
 */

/* Orange for what has been announced and what is over — the two ends of a
   tournament's life read as the brand rather than as a state to act on.
   Green is a way in, blue a closed door, red the thing happening now. */
const STATUSES = {
  announced: { color: "var(--color-primary, #EE7A4C)" },
  open: { color: "var(--status-open, #1E7A4A)" },
  waitlist: { color: "var(--status-open, #1E7A4A)" },
  closed: { color: "var(--status-closed, #1E6EF4)" },
  live: { color: "var(--status-live, #F16767)", dot: true },
  completed: { color: "var(--color-primary, #EE7A4C)" },
  cancelled: { color: "var(--status-live, #F16767)" },
  draft: { color: "var(--text-muted, #7A8294)" },
  archived: { color: "var(--text-muted, #7A8294)" },
};

const VARIANTS = {
  live: { bg: "var(--color-primary, #EE7A4C)", fg: "#fff", dot: true },
  open: { bg: "rgba(35, 150, 90, 0.14)", fg: "#1E7A4A", dot: true, dotColor: "#1E7A4A" },
  highlight: { bg: "var(--status-highlight, #FEF3D6)", fg: "var(--text-primary, #713F12)", dot: false },
  status: { bg: "var(--fills-tertiary, rgba(118,118,128,0.12))", fg: "var(--text-secondary, #5A6275)", dot: false },
  outline: { bg: "transparent", fg: "var(--text-primary, #14181E)", dot: false, border: true },
};

export function Badge({ variant = "live", status, children, style, className, ...rest }) {
  // A status is a status whatever `variant` says; the pill is the fallback.
  if (status) {
    const s = STATUSES[status] || STATUSES.announced;
    return (
      <span
        className={["lb-badge-status", className].filter(Boolean).join(" ")}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: s.color,
          fontFamily: "var(--font-text)",
          fontWeight: "var(--weight-bold)",
          fontSize: "var(--text-micro-size)",
          lineHeight: 1.2,
          letterSpacing: "var(--text-micro-tracking)",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          ...style,
        }}
        {...rest}
      >
        {s.dot && <span className="lb-badge-dot" aria-hidden="true" />}
        {children}
      </span>
    );
  }

  const v = VARIANTS[variant] || VARIANTS.live;
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        borderRadius: "var(--radius-pill)",
        background: v.bg,
        color: v.fg,
        border: v.border ? "1px solid var(--border-hairline)" : "none",
        fontFamily: "var(--font-text)",
        fontWeight: "var(--weight-bold)",
        fontSize: "var(--text-micro-size)",
        lineHeight: 1,
        letterSpacing: "var(--text-micro-tracking)",
        textTransform: "uppercase",
        boxSizing: "border-box",
        ...style,
      }}
      {...rest}
    >
      {v.dot && (
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: v.dotColor || "#fff", display: "inline-block" }} />
      )}
      {children}
    </span>
  );
}
