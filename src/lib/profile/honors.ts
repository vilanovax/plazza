import type { GlobalPlayerStats } from "../repo";

export interface Honor {
  icon: string;
  label: string;
}

/**
 * Derive achievement badges from lifetime stats. Purely computed (no storage),
 * so it's a foundation the app can grow — add rows here (or a real medals table)
 * later without a migration.
 */
export function deriveHonors(s: GlobalPlayerStats): Honor[] {
  const honors: Honor[] = [];
  if (s.handsWon >= 100) honors.push({ icon: "🏆", label: "صد برد" });
  else if (s.handsWon >= 25) honors.push({ icon: "🥈", label: "بیست‌وپنج برد" });
  else if (s.handsWon >= 10) honors.push({ icon: "🥉", label: "ده برد" });
  if (s.handsPlayed >= 500) honors.push({ icon: "🎖️", label: "کهنه‌کار" });
  if (s.tablesPlayed >= 5) honors.push({ icon: "🎲", label: "میزگرد" });
  if (s.biggestPot >= 5000) honors.push({ icon: "💰", label: "پات بزرگ" });
  if (s.netLifetime > 0) honors.push({ icon: "📈", label: "سودده" });
  const winRate = s.handsPlayed > 0 ? s.handsWon / s.handsPlayed : 0;
  if (s.handsPlayed >= 50 && winRate >= 0.35) honors.push({ icon: "🔥", label: "داغ" });
  return honors;
}
