import React from "react";

/**
 * Live Bracket — DateChip
 * Soft neutral pill that holds a date or time value. Pair two with
 * a "to" separator for tournament ranges.
 */
export function DateChip({ children, icon, style, ...rest }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 16px",
        borderRadius: "var(--radius-pill)",
        background: "var(--fills-tertiary, rgba(118,118,128,0.12))",
        color: "var(--text-primary)",
        fontFamily: "var(--font-ui)",
        fontSize: 15,
        lineHeight: 1,
        whiteSpace: "nowrap",
        boxSizing: "border-box",
        ...style,
      }}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}
