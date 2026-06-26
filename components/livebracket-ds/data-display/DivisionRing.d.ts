import * as React from "react";

export interface DivisionRingProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "style"> {
  /** Centered text, e.g. "19/24". @default "19/24" */
  value?: string;
  /** Optional label below the ring, e.g. "Men". */
  label?: string;
  /** Diameter in px. @default 38 */
  size?: number;
  /** Solid coral fill instead of ring outline. @default false */
  filled?: boolean;
  style?: React.CSSProperties;
}

/** Circular slots/registration indicator for tournament divisions. */
export function DivisionRing(props: DivisionRingProps): JSX.Element;
