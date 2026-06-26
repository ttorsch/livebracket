import * as React from "react";

export interface MatchTeam {
  name: string;
  /** Avatar/flag image URL. */
  avatar?: string;
  /** Per-set point totals, e.g. [21, 19]. */
  sets?: (number | string)[];
  /** Current/aggregate score shown large. */
  score?: number;
}

export interface MatchCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "style"> {
  /** Round label, e.g. "Men · Quarterfinals". */
  round?: string;
  teamA: MatchTeam;
  teamB: MatchTeam;
  /** Show a live marker. @default false */
  live?: boolean;
  style?: React.CSSProperties;
}

/**
 * A single bracket match — two team rows with sets, scores & winner emphasis.
 * @startingPoint section="Bracket" subtitle="Live match score card" viewport="700x220"
 */
export function MatchCard(props: MatchCardProps): JSX.Element;
