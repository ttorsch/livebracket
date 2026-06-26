import React from "react";

/**
 * Live Bracket — SegmentedControl
 * Tab-style selector with a sliding white "selected" pill on a
 * neutral track. Used for Latest / Starting Soon / Add Favorite
 * style filters. Each option may carry an icon node.
 */
export function SegmentedControl({ options = [], value, onChange, style, ...rest }) {
  const opts = options.map((o) => (typeof o === "string" ? { label: o, value: o } : o));
  const selected = value ?? opts[0]?.value;

  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: 4,
        borderRadius: "var(--radius-pill)",
        background: "var(--fills-tertiary, rgba(118,118,128,0.12))",
        boxSizing: "border-box",
        ...style,
      }}
      {...rest}
    >
      {opts.map((o) => {
        const isSel = o.value === selected;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={isSel}
            type="button"
            onClick={() => onChange && onChange(o.value)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: "none",
              cursor: "pointer",
              padding: "9px 18px",
              borderRadius: "var(--radius-pill)",
              fontFamily: "var(--font-ui)",
              fontWeight: 600,
              fontSize: 16,
              whiteSpace: "nowrap",
              background: isSel ? "var(--miscellaneous-segmented-control-selected-fill, #fff)" : "transparent",
              color: "var(--text-primary)",
              boxShadow: isSel ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
              transition: "background var(--duration-base) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard)",
            }}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
