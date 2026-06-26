import * as React from "react";

export interface BadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "style"> {
  /** @default "live" */
  variant?: "live" | "highlight" | "status" | "outline";
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/** Compact pill label — live status, highlight, neutral status. */
export function Badge(props: BadgeProps): JSX.Element;
