import * as React from "react";

export interface SearchFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "style" | "value" | "onChange"> {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** @default "Search" */
  placeholder?: string;
  /** Show the trailing mic icon. @default true */
  showMic?: boolean;
  style?: React.CSSProperties;
}

/** Pill search input with leading magnifier and trailing mic. */
export function SearchField(props: SearchFieldProps): JSX.Element;
