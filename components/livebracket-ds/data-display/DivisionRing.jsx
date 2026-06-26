import React from "react";

/**
 * Live Bracket — DivisionRing
 * Circular slots indicator used on tournament cards (e.g. "19/24"
 * registered, labelled "Men" / "Women"). Thin ink ring with the
 * count centered; optional label below.
 */
export function DivisionRing({ value = "19/24", label, size = 38, filled = false, style, ...rest }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 6, ...style }} {...rest}>
      <span
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: filled ? "none" : "inset 0 0 0 1px var(--border-strong)",
          background: filled ? "var(--color-primary)" : "transparent",
          color: filled ? "#fff" : "var(--text-primary)",
          fontFamily: "var(--font-ui)",
          fontWeight: 510,
          fontSize: Math.max(9, Math.round(size * 0.26)),
          boxSizing: "border-box",
        }}
      >
        {value}
      </span>
      {label && (
        <span style={{ fontFamily: "var(--font-text)", fontWeight: "var(--weight-bold)", fontSize: "var(--text-caption-size)", color: "var(--text-primary)" }}>
          {label}
        </span>
      )}
    </span>
  );
}
