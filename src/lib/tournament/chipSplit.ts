/** Split integer chips across recipients proportional to weight (stack size). */
export function splitChipsProportionally(
  amount: number,
  recipients: Array<{ id: string; weight: number }>
): Map<string, number> {
  const result = new Map<string, number>();
  if (amount <= 0 || recipients.length === 0) return result;

  const totalWeight = recipients.reduce((sum, r) => sum + Math.max(0, r.weight), 0);
  if (totalWeight <= 0) {
    const base = Math.floor(amount / recipients.length);
    let leftover = amount - base * recipients.length;
    for (const r of recipients) {
      const extra = leftover > 0 ? 1 : 0;
      if (extra) leftover -= 1;
      result.set(r.id, base + extra);
    }
    return result;
  }

  const shares = recipients.map((r) => {
    const raw = (amount * Math.max(0, r.weight)) / totalWeight;
    const floored = Math.floor(raw);
    return { id: r.id, floored, fraction: raw - floored };
  });

  const distributed = shares.reduce((sum, s) => sum + s.floored, 0);
  const leftover = amount - distributed;
  shares.sort((a, b) => b.fraction - a.fraction);

  for (let i = 0; i < shares.length; i++) {
    const extra = i < leftover ? 1 : 0;
    result.set(shares[i].id, shares[i].floored + extra);
  }
  return result;
}
