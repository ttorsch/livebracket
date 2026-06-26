import React from "react";

/**
 * Live Bracket — PageControl
 * Dot pagination for swipeable bracket/division carousels. Active
 * dot is ink; inactive dots are muted.
 */
export function PageControl({ count = 2, active = 0, onChange, style, ...rest }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, ...style }} {...rest}>
      {Array.from({ length: count }).map((_, i) => {
        const isActive = i === active;
        return (
          <button
            key={i}
            type="button"
            aria-label={`Go to page ${i + 1}`}
            aria-current={isActive}
            onClick={() => onChange && onChange(i)}
            style={{
              width: isActive ? 8 : 7,
              height: isActive ? 8 : 7,
              borderRadius: "50%",
              border: "none",
              padding: 0,
              cursor: "pointer",
              background: isActive ? "var(--text-primary)" : "var(--gray-300)",
              transition: "background var(--duration-base) var(--ease-standard)",
            }}
          />
        );
      })}
    </span>
  );
}
