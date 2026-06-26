import * as React from "react";

export interface AvatarProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "style"> {
  /** Image URL. Falls back to initials, then a neutral disc. */
  src?: string;
  /** Used for initials + alt text. */
  name?: string;
  /** Diameter in px. @default 38 */
  size?: number;
  style?: React.CSSProperties;
}

/** Circular team/user avatar — image, initials, or placeholder disc. */
export function Avatar(props: AvatarProps): JSX.Element;
