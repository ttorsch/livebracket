import React from "react";

/**
 * Live Bracket — Logo
 * The bracket mark (coral disc + stepped bracket glyph) plus the
 * "LIVE BRACKET" wordmark in Inter. Render mark-only, wordmark, or
 * the full lockup. Mark is inlined so it works from any path.
 */
function Mark({ size = 40, disc = true }) {
  return (
    <svg width={size} height={size} viewBox="0 0 687 687" style={{ display: "block", flexShrink: 0 }} aria-hidden="true">
      {disc && <circle cx="343.5" cy="343.5" r="343.5" fill="var(--color-primary)" />}
      <g transform="translate(167,193)" fill="#ffffff">
        <clipPath id="lb-mark-clip"><rect x="0" y="0" width="354" height="302" /></clipPath>
        <g clipPath="url(#lb-mark-clip)" fill={disc ? "#ffffff" : "var(--color-primary)"}>
          <svg x="0" y="29" width="138" height="30" viewBox="0 -15 138 30"><path d="M 15 -30 C 6.716 -30 0 -23.284 0 -15 C 0 -6.716 6.716 0 15 0 L 15 -15 L 15 -30 Z M 123 0 C 131.284 0 138 -6.716 138 -15 C 138 -23.284 131.284 -30 123 -30 L 123 -15 L 123 0 Z M 15 -15 L 15 0 L 123 0 L 123 -15 L 123 -30 L 15 -30 L 15 -15 Z" /></svg>
          <svg x="138" y="91" width="138" height="30" viewBox="0 -15 138 30"><path d="M 15 -30 C 6.716 -30 0 -23.284 0 -15 C 0 -6.716 6.716 0 15 0 L 15 -15 L 15 -30 Z M 123 0 C 131.284 0 138 -6.716 138 -15 C 138 -23.284 131.284 -30 123 -30 L 123 -15 L 123 0 Z M 15 -15 L 15 0 L 123 0 L 123 -15 L 123 -30 L 15 -30 L 15 -15 Z" /></svg>
          <svg x="138" y="242" width="108" height="30" viewBox="0 -15 108 30"><path d="M 15 -30 C 6.716 -30 0 -23.284 0 -15 C 0 -6.716 6.716 0 15 0 L 15 -15 L 15 -30 Z M 93 0 C 101.284 0 108 -6.716 108 -15 C 108 -23.284 101.284 -30 93 -30 L 93 -15 L 93 0 Z M 15 -15 L 15 0 L 93 0 L 93 -15 L 93 -30 L 15 -30 L 15 -15 Z" /></svg>
          <svg x="246" y="220" width="108" height="30" viewBox="0 -15 108 30"><path d="M 15 -30 C 6.716 -30 0 -23.284 0 -15 C 0 -6.716 6.716 0 15 0 L 15 -15 L 15 -30 Z M 93 0 C 101.284 0 108 -6.716 108 -15 C 108 -23.284 101.284 -30 93 -30 L 93 -15 L 93 0 Z M 15 -15 L 15 0 L 93 0 L 93 -15 L 93 -30 L 15 -30 L 15 -15 Z" /></svg>
          <svg x="0" y="272" width="138" height="30" viewBox="0 -15 138 30"><path d="M 15 -30 C 6.716 -30 0 -23.284 0 -15 C 0 -6.716 6.716 0 15 0 L 15 -15 L 15 -30 Z M 123 0 C 131.284 0 138 -6.716 138 -15 C 138 -23.284 131.284 -30 123 -30 L 123 -15 L 123 0 Z M 15 -15 L 15 0 L 123 0 L 123 -15 L 123 -30 L 15 -30 L 15 -15 Z" /></svg>
          <g transform="matrix(0,1,-1,0,108,0)"><svg x="0" y="0" width="151" height="30" viewBox="0 -15 151 30"><path d="M 15 -30 C 6.716 -30 0 -23.284 0 -15 C 0 -6.716 6.716 0 15 0 L 15 -15 L 15 -30 Z M 136 0 C 144.284 0 151 -6.716 151 -15 C 151 -23.284 144.284 -30 136 -30 L 136 -15 L 136 0 Z M 15 -15 L 15 0 L 136 0 L 136 -15 L 136 -30 L 15 -30 L 15 -15 Z" /></svg></g>
          <g transform="matrix(0,1,-1,0,246,61)"><svg x="0" y="0" width="159" height="30" viewBox="0 -15 159 30"><path d="M 15 -30 C 6.716 -30 0 -23.284 0 -15 C 0 -6.716 6.716 0 15 0 L 15 -15 L 15 -30 Z M 144 0 C 152.284 0 159 -6.716 159 -15 C 159 -23.284 152.284 -30 144 -30 L 144 -15 L 144 0 Z M 15 -15 L 15 0 L 144 0 L 144 -15 L 144 -30 L 15 -30 L 15 -15 Z" /></svg></g>
          <g transform="matrix(0,1,-1,0,108,151)"><svg x="0" y="0" width="151" height="30" viewBox="0 -15 151 30"><path d="M 15 -30 C 6.716 -30 0 -23.284 0 -15 C 0 -6.716 6.716 0 15 0 L 15 -15 L 15 -30 Z M 136 0 C 144.284 0 151 -6.716 151 -15 C 151 -23.284 144.284 -30 136 -30 L 136 -15 L 136 0 Z M 15 -15 L 15 0 L 136 0 L 136 -15 L 136 -30 L 15 -30 L 15 -15 Z" /></svg></g>
        </g>
      </g>
    </svg>
  );
}

export function Logo({ variant = "lockup", size = 40, color = "var(--text-primary)", style, ...rest }) {
  if (variant === "mark") return <Mark size={size} disc={true} {...rest} />;

  const wordmark = (
    <span
      className="lb-wordmark"
      style={{
        fontFamily: "var(--font-ui)",
        fontWeight: 400,
        fontSize: size * 0.62,
        letterSpacing: "0.01em",
        color,
        whiteSpace: "nowrap",
        lineHeight: 1,
      }}
    >
      LIVE BRACKET
    </span>
  );

  if (variant === "wordmark") return <span style={style} {...rest}>{wordmark}</span>;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: size * 0.3, ...style }} {...rest}>
      <Mark size={size} disc={true} />
      {wordmark}
    </span>
  );
}
