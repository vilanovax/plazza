/** Standard table chip colours (largest first for greedy breakdown). */
export const TABLE_CHIP_VALUES = [500, 100, 50, 25] as const;
export type TableChipValue = (typeof TABLE_CHIP_VALUES)[number];

export type ChipColor = "black" | "green" | "yellow" | "blue";

export const CHIP_COLOR_BY_VALUE: Record<TableChipValue, ChipColor> = {
  500: "black",
  100: "green",
  50: "yellow",
  25: "blue",
};

/** Greedy breakdown of an integer bet into standard denominations. */
export function breakDownChips(amount: number): Array<{ value: TableChipValue; count: number }> {
  let rem = Math.max(0, Math.floor(amount));
  const out: Array<{ value: TableChipValue; count: number }> = [];
  for (const value of TABLE_CHIP_VALUES) {
    const count = Math.floor(rem / value);
    if (count > 0) out.push({ value, count });
    rem %= value;
  }
  return out;
}

/** Flat list of chip values for rendering (largest first). */
export function chipsForDisplay(amount: number, max = 5): TableChipValue[] {
  const flat: TableChipValue[] = [];
  for (const { value, count } of breakDownChips(amount)) {
    for (let i = 0; i < count; i++) flat.push(value);
  }
  return flat.slice(0, max);
}

export function chipsOverflow(amount: number, max = 5): number {
  const total = breakDownChips(amount).reduce((sum, c) => sum + c.count, 0);
  return Math.max(0, total - max);
}
