import React from "react";

/**
 * Live Bracket — Card
 * Standard opaque surface: warm white, soft ambient shadow, large
 * radius. The everyday container for tournament rows and panels.
 */
export function Card({ padding = 20, radius = "xl", interactive = false, children, style, ...rest }) {
  const radii = { md: "var(--radius-md)", lg: "var(--radius-lg)", xl: "var(--radius-xl)", "2xl": "var(--radius-2xl)" };
  return (
    <div
      style={{
        background: "var(--surface-card)",
        borderRadius: radii[radius] || radii.xl,
        boxShadow: "var(--shadow-card)",
        padding,
        boxSizing: "border-box",
        transition: "transform var(--duration-base) var(--ease-out), box-shadow var(--duration-base) var(--ease-out)",
        cursor: interactive ? "pointer" : "default",
        ...style,
      }}
      onMouseEnter={interactive ? (e) => { e.currentTarget.style.transform = "translateY(-2px)"; } : undefined}
      onMouseLeave={interactive ? (e) => { e.currentTarget.style.transform = "translateY(0)"; } : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}
