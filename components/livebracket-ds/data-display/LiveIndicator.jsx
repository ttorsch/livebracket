import React from "react";

/**
 * Live Bracket — LiveIndicator
 * Pulsing red dot + "Live Now" label used on active tournaments.
 */
export function LiveIndicator({ label = "Live Now", size = 10, style, ...rest }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, ...style }} {...rest}>
      <style>{"@keyframes lb-pulse{0%{box-shadow:0 0 0 0 rgba(241,103,103,0.55)}70%{box-shadow:0 0 0 8px rgba(241,103,103,0)}100%{box-shadow:0 0 0 0 rgba(241,103,103,0)}}"}</style>
      <span
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: "var(--status-live)",
          display: "inline-block",
          animation: "lb-pulse 1.8s var(--ease-standard) infinite",
        }}
      />
      {label && (
        <span style={{ fontFamily: "var(--font-text)", fontWeight: "var(--weight-bold)", fontSize: "var(--text-body-size)", color: "var(--text-primary)" }}>
          {label}
        </span>
      )}
    </span>
  );
}
