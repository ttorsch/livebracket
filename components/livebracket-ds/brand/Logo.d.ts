import * as React from "react";

export interface LogoProps extends Omit<React.HTMLAttributes<HTMLElement>, "style" | "color"> {
  /** @default "lockup" */
  variant?: "lockup" | "mark" | "wordmark";
  /** Mark height / wordmark scale in px. @default 40 */
  size?: number;
  /** Wordmark color. @default var(--text-primary) */
  color?: string;
  style?: React.CSSProperties;
}

/** Live Bracket logo — coral bracket mark + "LIVE BRACKET" wordmark. */
export function Logo(props: LogoProps): JSX.Element;
