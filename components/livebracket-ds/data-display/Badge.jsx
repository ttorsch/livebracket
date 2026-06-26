import React from "react";

/**
 * Live Bracket — Badge
 * Compact pill label. "live" pulses a coral indicator; "highlight"
 * is the warm amber chip; "status" is a soft neutral.
 */
export function Badge({ variant = "live", children, style, ...rest }) {
  const variants = {
    live: { bg: "var(--color-primary)", fg: "#fff", dot: true },
    highlight: { bg: "var(--status-highlight)", fg: "var(--text-primary)", dot: false },
    status: { bg: "var(--fills-tertiary, rgba(118,118,128,0.12))", fg: "var(--text-secondary)", dot: false },
    outline: { bg: "transparent", fg: "var(--text-primary)", dot: false, border: true },
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
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", display: "inline-block" }} />
      )}
      {children}
    </span>
  );
}
