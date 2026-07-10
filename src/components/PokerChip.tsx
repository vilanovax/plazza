import type { CSSProperties } from "react";
import type { TableChipValue } from "@/lib/poker/chipDenominations";
import { CHIP_COLOR_BY_VALUE } from "@/lib/poker/chipDenominations";

export function PokerChip({
  value,
  size = "md",
  style,
}: {
  value: TableChipValue;
  size?: "sm" | "md" | "lg";
  style?: CSSProperties;
}) {
  const color = CHIP_COLOR_BY_VALUE[value];
  return (
    <span
      className={`poker-chip poker-chip--${color} poker-chip--${size}`}
      style={style}
      aria-hidden
    >
      <span className="poker-chip-face">{value.toLocaleString("fa")}</span>
    </span>
  );
}
