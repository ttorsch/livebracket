import * as React from "react";

export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "style"> {
  /** Inner padding in px. @default 20 */
  padding?: number | string;
  /** @default "xl" */
  radius?: "md" | "lg" | "xl" | "2xl";
  /** Lift on hover. @default false */
  interactive?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/** Opaque warm-white surface with soft ambient shadow. */
export function Card(props: CardProps): JSX.Element;
