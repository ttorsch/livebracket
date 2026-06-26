import React, { useState } from "react";

// Inject the spinner keyframes once (kept out of the button element
// so they don't leak into button.textContent).
if (typeof document !== "undefined" && !document.getElementById("lb-spin-kf")) {
  const s = document.createElement("style");
  s.id = "lb-spin-kf";
  s.textContent = "@keyframes lb-spin{to{transform:rotate(360deg)}}";
  document.head.appendChild(s);
}

/**
 * Live Bracket — Button
 * Pill-shaped action button. Four variants pulled from the KLV
 * Buttons Matrix: primary (solid coral), secondary (soft coral),
 * general (white), and arrow (icon-only circle).
 */
export function Button({
  variant = "primary",
  size = "medium",
  iconRight,
  iconLeft,
  loading = false,
  disabled = false,
  fullWidth = false,
  children,
  style,
  onClick,
  ...rest
}) {
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);
  const isArrow = variant === "arrow";
  const isDisabled = disabled || loading;

  const sizes = {
    medium: { pad: "12px 24px", font: 14, height: 42, circle: 44 },
    small: { pad: "8px 18px", font: 13, height: 34, circle: 36 },
  };
  const sz = sizes[size] || sizes.medium;

  const palettes = {
    primary: {
      bg: "var(--color-primary)",
      bgHover: "var(--color-primary-hover)",
      fg: "var(--color-on-primary)",
      shadow: "var(--shadow-primary)",
    },
    secondary: {
      bg: "var(--color-primary-soft)",
      bgHover: "rgba(235,111,67,0.30)",
      fg: "#ffffff",
      shadow: "none",
    },
    general: {
      bg: "var(--surface-card)",
      bgHover: "var(--gray-100)",
      fg: "var(--text-primary)",
      shadow: "0 1px 2px rgba(0,0,0,0.08)",
    },
    arrow: {
      bg: "var(--color-primary)",
      bgHover: "var(--color-primary-hover)",
      fg: "var(--color-on-primary)",
      shadow: "var(--shadow-primary)",
    },
  };
  const p = palettes[variant] || palettes.primary;

  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    border: "none",
    cursor: isDisabled ? "not-allowed" : "pointer",
    fontFamily: "var(--font-text)",
    fontWeight: "var(--weight-bold)",
    fontSize: sz.font,
    lineHeight: 1,
    whiteSpace: "nowrap",
    borderRadius: "var(--radius-pill)",
    transition: "background var(--duration-base) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard)",
    boxShadow: hover && !isDisabled ? p.shadow : (variant === "primary" || variant === "arrow" ? p.shadow : p.shadow),
    transform: active && !isDisabled ? "scale(0.96)" : "scale(1)",
    width: fullWidth ? "100%" : (isArrow ? sz.circle : "auto"),
    height: isArrow ? sz.circle : sz.height,
    padding: isArrow ? 0 : sz.pad,
    background: isDisabled ? "var(--gray-300)" : (hover ? p.bgHover : p.bg),
    color: isDisabled ? "var(--gray-500)" : p.fg,
    opacity: isDisabled ? 0.7 : 1,
    boxSizing: "border-box",
    outline: "none",
    ...style,
  };

  const spinner = (
    <span
      aria-hidden="true"
      style={{
        width: 14,
        height: 14,
        borderRadius: "50%",
        border: `1.5px solid ${variant === "general" ? "var(--text-primary)" : (variant === "secondary" ? "var(--color-primary)" : "#fff")}`,
        borderTopColor: "transparent",
        display: "inline-block",
        animation: "lb-spin 0.7s linear infinite",
      }}
    />
  );

  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setActive(false); }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      onFocus={(e) => (e.currentTarget.style.boxShadow = `0 0 0 4px var(--focus-ring)`)}
      onBlur={(e) => (e.currentTarget.style.boxShadow = base.boxShadow || "none")}
      style={base}
      {...rest}
    >
      {loading ? spinner : (
        <>
          {iconLeft}
          {!isArrow && children}
          {iconRight}
          {isArrow && !iconRight && !iconLeft && (
            <span style={{ fontSize: 16, lineHeight: 1 }}>→</span>
          )}
        </>
      )}
    </button>
  );
}
