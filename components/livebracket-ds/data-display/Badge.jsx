import React from "react";

/**
 * Live Bracket — Badge
 * Compact pill label. "live" pulses a coral indicator; "highlight"
 * is the warm amber chip; "status" is a soft neutral.
 */
export function Badge({ variant = "live", children, style, ...rest }) {
  const variants = {
    live: { bg: "var(--color-primary, #EE7A4C)", fg: "#fff", dot: true },
    open: { bg: "rgba(35, 150, 90, 0.14)", fg: "#1E7A4A", dot: true, dotColor: "#1E7A4A" },
    highlight: { bg: "var(--status-highlight, #FEF3D6)", fg: "var(--text-primary, #713F12)", dot: false },
    status: { bg: "var(--fills-tertiary, rgba(118,118,128,0.12))", fg: "var(--text-secondary, #5A6275)", dot: false },
    outline: { bg: "transparent", fg: "var(--text-primary, #14181E)", dot: false, border: true },
  };
  const v = variants[variant] || variants.live;
  return (
    <span
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
