import React from "react";
import { Icon } from "../icons/Icon.jsx";

/**
 * Live Bracket — SearchField
 * Pill search input with a leading magnifier and trailing mic,
 * matching the tournament-listing search bar. Soft neutral fill.
 */
export function SearchField({ value, onChange, placeholder = "Search", showMic = true, style, ...rest }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 48,
        padding: "0 18px",
        borderRadius: "var(--radius-pill)",
        background: "var(--fills-tertiary, rgba(118,118,128,0.12))",
        boxSizing: "border-box",
        ...style,
      }}
    >
      <Icon name="search" size={20} color="var(--text-muted)" />
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        style={{
          flex: 1,
          border: "none",
          background: "transparent",
          outline: "none",
          fontFamily: "var(--font-ui)",
          fontSize: 17,
          color: "var(--text-primary)",
          minWidth: 0,
        }}
        {...rest}
      />
      {showMic && <Icon name="mic" size={20} color="var(--text-muted)" />}
    </div>
  );
}
