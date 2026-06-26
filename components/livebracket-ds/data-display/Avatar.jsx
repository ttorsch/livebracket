import React from "react";

/**
 * Live Bracket — Avatar
 * Circular user/team avatar. Renders an image, initials, or a
 * neutral placeholder disc (matching the product header avatars).
 */
export function Avatar({ src, name, size = 38, style, ...rest }) {
  const initials = name
    ? name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()
    : "";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        background: src ? "transparent" : "var(--gray-300)",
        color: "var(--text-secondary)",
        fontFamily: "var(--font-text)",
        fontWeight: "var(--weight-bold)",
        fontSize: Math.round(size * 0.36),
        overflow: "hidden",
        flexShrink: 0,
        boxSizing: "border-box",
        ...style,
      }}
      {...rest}
    >
      {src ? (
        <img src={src} alt={name || ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        initials
      )}
    </span>
  );
}
