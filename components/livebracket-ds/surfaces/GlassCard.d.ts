import * as React from "react";

export interface GlassCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "style"> {
  /** @default "light" */
  tone?: "light" | "dark";
  /** @default "2xl" */
  radius?: "lg" | "xl" | "2xl" | "3xl";
  /** Inner padding in px. @default 24 */
  padding?: number | string;
  /** @default "glass" */
  elevation?: "glass" | "deep" | "none";
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * Frosted "liquid glass" surface — the signature Live Bracket panel over photo backdrops.
 * @startingPoint section="Surfaces" subtitle="Frosted liquid-glass panel" viewport="700x260"
 */
export function GlassCard(props: GlassCardProps): JSX.Element;
