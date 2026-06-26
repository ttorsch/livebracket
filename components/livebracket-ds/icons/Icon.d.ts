import * as React from "react";

export type IconName =
  | "search" | "mic" | "location" | "star" | "starFilled"
  | "arrowRight" | "chevronRight" | "chevronDown" | "x"
  | "trophy" | "users" | "calendar" | "bell" | "plus" | "filter" | "play";

export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, "style" | "name"> {
  /** Icon name. */
  name: IconName;
  /** Pixel size (width & height). @default 20 */
  size?: number;
  /** @default 1.75 */
  strokeWidth?: number;
  /** Overrides currentColor. */
  color?: string;
  style?: React.CSSProperties;
}

/** Lucide-derived line icon set (substituted for the source SF Symbols). */
export function Icon(props: IconProps): JSX.Element;
