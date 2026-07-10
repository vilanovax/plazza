import { chipsForDisplay, chipsOverflow } from "@/lib/poker/chipDenominations";
import { PokerChip } from "./PokerChip";

export function ChipStack({
  amount,
  compact,
  showAmount = true,
  maxChips = 4,
}: {
  amount: number;
  compact?: boolean;
  showAmount?: boolean;
  maxChips?: number;
}) {
  if (amount <= 0) return null;
  const chips = chipsForDisplay(amount, maxChips);
  const overflow = chipsOverflow(amount, maxChips);
  const size = compact ? "sm" : "md";

  return (
    <div className="chip-stack" aria-label={`${amount.toLocaleString("fa")} ژتون`}>
      <div className="chip-stack-pile">
        {chips.map((value, i) => (
          <PokerChip
            key={`${value}-${i}`}
            value={value}
            size={size}
            style={{ "--chip-i": i } as React.CSSProperties}
          />
        ))}
        {overflow > 0 && (
          <span className="chip-stack-more">+{overflow.toLocaleString("fa")}</span>
        )}
      </div>
      {showAmount && (
        <span className="chip-stack-amount">{amount.toLocaleString("fa")}</span>
      )}
    </div>
  );
}
