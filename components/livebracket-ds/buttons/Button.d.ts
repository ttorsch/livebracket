import * as React from "react";

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "style"> {
  /** Visual style. @default "primary" */
  variant?: "primary" | "secondary" | "general" | "arrow";
  /** @default "medium" */
  size?: "medium" | "small";
  /** Icon node rendered after the label. */
  iconRight?: React.ReactNode;
  /** Icon node rendered before the label. */
  iconLeft?: React.ReactNode;
  /** Show a spinner and disable interaction. @default false */
  loading?: boolean;
  /** @default false */
  disabled?: boolean;
  /** Stretch to container width. @default false */
  fullWidth?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * Pill action button — the core CTA across Live Bracket.
 * @startingPoint section="Buttons" subtitle="Primary, secondary, general & arrow pill buttons" viewport="700x180"
 */
export function Button(props: ButtonProps): JSX.Element;
