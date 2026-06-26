import React from "react";
import { Avatar } from "../data-display/Avatar.jsx";

/**
 * Live Bracket — MatchCard
 * A single bracket match: round label plus two team rows with
 * avatar, name, and per-set scores. The winning team is emphasised
 * with bold ink; the loser is muted.
 */
function TeamRow({ team, isWinner, live }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Avatar src={team.avatar} name={team.name} size={28} />
      <span
        style={{
          flex: 1,
          fontFamily: "var(--font-text)",
          fontWeight: isWinner ? "var(--weight-bold)" : "var(--weight-medium)",
          fontSize: "var(--text-body-lg-size)",
          color: isWinner ? "var(--text-primary)" : "var(--text-muted)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {team.name}
      </span>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        {(team.sets || []).map((s, i) => (
          <span
            key={i}
            style={{
              fontFamily: "var(--font-display)",
              fontVariantNumeric: "tabular-nums",
              fontWeight: "var(--weight-bold)",
              fontSize: 15,
              width: 18,
              textAlign: "center",
              color: isWinner ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {s}
          </span>
        ))}
        {team.score != null && (
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontVariantNumeric: "tabular-nums",
              fontWeight: "var(--weight-bold)",
              fontSize: 28,
              minWidth: 32,
              textAlign: "right",
              color: isWinner ? "var(--color-primary)" : "var(--text-primary)",
            }}
          >
            {team.score}
          </span>
        )}
      </div>
    </div>
  );
}

export function MatchCard({ round, teamA, teamB, live = false, style, ...rest }) {
  const aWins = teamA?.score != null && teamB?.score != null && teamA.score > teamB.score;
  const bWins = teamA?.score != null && teamB?.score != null && teamB.score > teamA.score;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: 18,
        borderRadius: "var(--radius-lg)",
        background: "var(--surface-card)",
        boxShadow: "var(--shadow-card)",
        boxSizing: "border-box",
        ...style,
      }}
      {...rest}
    >
      {(round || live) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {round && (
            <span style={{ fontFamily: "var(--font-text)", fontWeight: "var(--weight-bold)", fontSize: "var(--text-caption-size)", letterSpacing: "var(--text-micro-tracking)", textTransform: "uppercase", color: "var(--text-muted)" }}>
              {round}
            </span>
          )}
          {live && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "var(--font-text)", fontWeight: "var(--weight-bold)", fontSize: "var(--text-micro-size)", letterSpacing: "var(--text-micro-tracking)", textTransform: "uppercase", color: "var(--status-live)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--status-live)" }} /> Live
            </span>
          )}
        </div>
      )}
      <TeamRow team={teamA} isWinner={aWins} />
      <div style={{ height: 1, background: "var(--border-hairline)" }} />
      <TeamRow team={teamB} isWinner={bWins} />
    </div>
  );
}
