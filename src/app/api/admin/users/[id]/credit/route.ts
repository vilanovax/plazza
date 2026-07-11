import { randomUUID } from "node:crypto";
import { handler, error, json, requireAdmin } from "@/lib/api";
import { clientIp } from "@/lib/rateLimit";
import * as repo from "@/lib/repo";

// Admin credits (+) or debits (-) a player's chip bank. Recorded in the ledger.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const { amount, note } = await req.json();
    const amt = Math.floor(Number(amount));
    if (!amt || Number.isNaN(amt)) return error("مبلغ نامعتبر است");

    const user = await repo.getUserById(id);
    if (!user) return error("کاربر یافت نشد", 404);

    const entry = await repo.applyLedger({
      userId: id,
      type: amt >= 0 ? "admin_credit" : "admin_debit",
      amount: amt,
      note: note ? String(note) : amt >= 0 ? "شارژ توسط مدیر" : "کسر توسط مدیر",
      createdBy: admin.sub,
    });
    await repo.writeAudit({
      correlationId: randomUUID(), actorId: admin.sub,
      action: amt >= 0 ? "admin.credit" : "admin.debit", targetType: "user", targetId: id,
      metadata: { amount: amt, balanceAfter: Number(entry.balance_after) }, ip: clientIp(req),
    });
    return json({ balanceAfter: Number(entry.balance_after) });
  });
}
