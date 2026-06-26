import * as React from "react";

export interface LiveIndicatorProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "style"> {
  /** @default "Live Now" */
  label?: string;
  /** Dot diameter in px. @default 10 */
  size?: number;
  style?: React.CSSProperties;
}

/** Pulsing red dot + label marking an in-progress tournament. */
export function LiveIndicator(props: LiveIndicatorProps): JSX.Element;
