import { handler, json, requireAdmin } from "@/lib/api";
import * as repo from "@/lib/repo";

export async function GET() {
  return handler(async () => {
    await requireAdmin();
    const [entries, users] = await Promise.all([repo.listAllLedger(500), repo.listUsers()]);
    const names = new Map(users.map((u) => [u.id, u.display_name]));
    return json({
      ledger: entries.map((l) => ({
        id: l.id,
        userId: l.user_id,
        userName: names.get(l.user_id) ?? "?",
        type: l.type,
        amount: Number(l.amount),
        balanceAfter: Number(l.balance_after),
        counterpartyId: l.counterparty_id,
        counterpartyName: l.counterparty_id ? names.get(l.counterparty_id) ?? null : null,
        note: l.note,
        settled: l.settled,
        createdAt: l.created_at,
      })),
    });
  });
}
