import React from "react";

/**
 * Live Bracket — Logo
 * The bracket mark (coral disc + stepped bracket glyph) plus the
 * "LIVE BRACKET" wordmark in Inter. Render mark-only, wordmark, or
 * the full lockup. Mark is inlined so it works from any path.
 */
function Mark({ size = 32, disc = true }) {
  const glyphFill = disc ? "#ffffff" : "#EB6F43";
  return (
    <span
      style={{
        display: "grid",
        placeItems: "center",
        width: size,
        height: size,
        flexShrink: 0,
        filter: "drop-shadow(0 4px 10px rgba(242, 103, 73, 0.45))",
      }}
      aria-hidden="true"
    >
      <svg width={size} height={size} viewBox="296 73 687 687" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block", width: "100%", height: "100%" }}>
        {disc && <circle cx="639.5" cy="416.5" r="343.5" fill="#EB6F43" />}
        <rect x="428" y="234" width="165.327" height="35.9406" rx="15" fill={glyphFill} />
        <rect x="428" y="561.059" width="165.327" height="35.9406" rx="15" fill={glyphFill} />
        <rect x="593.327" y="308.277" width="165.327" height="35.9406" rx="15" fill={glyphFill} />
        <rect x="722.713" y="462.822" width="129.386" height="35.9406" rx="15" fill={glyphFill} />
        <rect x="593.327" y="489.178" width="129.386" height="35.9406" rx="15" fill={glyphFill} />
        <rect x="557.386" y="416.099" width="182.099" height="35.9406" rx="15" transform="rotate(-90 557.386 416.099)" fill={glyphFill} />
        <rect x="722.713" y="498.762" width="190.485" height="35.9406" rx="15.5" transform="rotate(-90 722.713 498.762)" fill={glyphFill} />
        <rect x="557.386" y="597" width="180.901" height="35.9406" rx="15" transform="rotate(-90 557.386 597)" fill={glyphFill} />
      </svg>
    </span>
  );
}

export function Logo({ variant = "lockup", size = 32, color = "#14181E", style, className, ...rest }) {
  if (variant === "mark") return <Mark size={size} disc={true} {...rest} />;

  const wordmark = (
    <span
      className="lb-wordmark"
      style={{
        fontFamily: "var(--font-heading, 'Space Grotesk', sans-serif)",
        fontWeight: 800,
        fontSize: Math.round(size * 0.5625) || 18,
        letterSpacing: "0.05em",
        color,
        whiteSpace: "nowrap",
        lineHeight: 1,
      }}
    >
      LIVE BRACKET
    </span>
  );

  if (variant === "wordmark") return <span style={style} className={className} {...rest}>{wordmark}</span>;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, ...style }} className={className} {...rest}>
      <Mark size={size} disc={true} />
      {wordmark}
    </span>
  );
}
