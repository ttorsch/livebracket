import * as React from "react";

export interface DateChipProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "style"> {
  /** Optional leading icon node. */
  icon?: React.ReactNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/** Soft neutral pill holding a date or time value. */
export function DateChip(props: DateChipProps): JSX.Element;
