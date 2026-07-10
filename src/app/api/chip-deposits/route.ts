import { handler, json, requireSession } from "@/lib/api";
import * as repo from "@/lib/repo";

/** Public chip-purchase ledger for the lobby (admin credits only). */
export async function GET() {
  return handler(async () => {
    const session = await requireSession();
    const [summary, recent] = await Promise.all([
      repo.listChipPurchaseSummary(),
      repo.listRecentChipDeposits(100),
    ]);
    return json({
      summary: summary.map((r) => ({
        userId: r.user_id,
        displayName: r.display_name,
        chipBalance: Number(r.chip_balance),
        totalPurchased: Number(r.total_purchased),
        purchaseCount: r.purchase_count,
      })),
      recent: recent.map((r) => ({
        id: r.id,
        userId: r.user_id,
        displayName: r.display_name,
        amount: Number(r.amount),
        note: r.note,
        settled: r.settled,
        createdAt: r.created_at,
        recordedBy: r.created_by_name,
      })),
      viewerRole: session.role,
    });
  });
}
