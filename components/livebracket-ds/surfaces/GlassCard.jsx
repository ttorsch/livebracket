import React from "react";

/**
 * Live Bracket — GlassCard
 * The signature "liquid glass" surface: frosted translucent panel
 * with a bright rim and deep floating shadow. Designed to sit over
 * the beach-photo backdrop. Falls back to a soft white card where
 * backdrop-filter is unavailable.
 */
export function GlassCard({
  tone = "light",
  radius = "2xl",
  padding = 24,
  elevation = "glass",
  children,
  style,
  ...rest
}) {
  const radii = {
    lg: "var(--radius-lg)",
    xl: "var(--radius-xl)",
    "2xl": "var(--radius-2xl)",
    "3xl": "var(--radius-3xl)",
  };
  const shadows = {
    glass: "var(--shadow-glass)",
    deep: "var(--shadow-glass-deep)",
    none: "none",
  };
  const isDark = tone === "dark";

  return (
    <div
      style={{
        position: "relative",
        borderRadius: radii[radius] || radii["2xl"],
        padding,
        background: isDark ? "var(--glass-fill-dark)" : "var(--glass-fill)",
        WebkitBackdropFilter: "var(--glass-blur)",
        backdropFilter: "var(--glass-blur)",
        boxShadow: `var(--glass-rim), ${shadows[elevation] || shadows.glass}`,
        border: `1px solid ${isDark ? "var(--glass-border-dark)" : "var(--glass-border)"}`,
        color: isDark ? "var(--text-on-ink)" : "var(--text-primary)",
        boxSizing: "border-box",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
