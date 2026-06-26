import * as React from "react";

export interface SegmentOption {
  label: string;
  value: string;
  icon?: React.ReactNode;
}

export interface SegmentedControlProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "onChange"> {
  /** Options as strings or {label, value, icon}. */
  options: (string | SegmentOption)[];
  /** Selected value (defaults to first option). */
  value?: string;
  onChange?: (value: string) => void;
  style?: React.CSSProperties;
}

/**
 * Tab-style selector with a sliding white pill on a neutral track.
 * @startingPoint section="Forms" subtitle="Segmented filter control" viewport="700x120"
 */
export function SegmentedControl(props: SegmentedControlProps): JSX.Element;
