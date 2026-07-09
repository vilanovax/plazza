import { handler, json, requireSession } from "@/lib/api";
import * as repo from "@/lib/repo";

// The player's own bank balance + chip history (simple accounting).
export async function GET() {
  return handler(async () => {
    const session = await requireSession();
    const user = await repo.getUserById(session.sub);
    const ledger = await repo.listLedger(session.sub, 200);
    return json({
      balance: Number(user?.chip_balance ?? 0),
      ledger: ledger.map((l) => ({
        id: l.id,
        type: l.type,
        amount: Number(l.amount),
        balanceAfter: Number(l.balance_after),
        note: l.note,
        settled: l.settled,
        createdAt: l.created_at,
      })),
    });
  });
}
