import * as React from "react";
import type { TournamentStatusKey } from "../../../lib/tournamentStatus";

export interface BadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "style"> {
  /**
   * Where a tournament is up to. Renders as coloured uppercase text with no
   * pill — the shape a status takes everywhere it is shown. Takes precedence
   * over `variant`.
   */
  status?: TournamentStatusKey;
  /** Filled pill, for everything that is not a tournament status. @default "live" */
  variant?: "live" | "open" | "highlight" | "status" | "outline";
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/** Tournament status as coloured text, or a compact pill for anything else. */
export function Badge(props: BadgeProps): JSX.Element;
