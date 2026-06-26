import * as React from "react";

export interface PageControlProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "style" | "onChange"> {
  /** Number of dots. @default 2 */
  count?: number;
  /** Active index (0-based). @default 0 */
  active?: number;
  /** Called with the clicked index. */
  onChange?: (index: number) => void;
  style?: React.CSSProperties;
}

/** Dot pagination for swipeable bracket/division carousels. */
export function PageControl(props: PageControlProps): JSX.Element;
