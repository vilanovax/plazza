import { randomUUID } from "node:crypto";
import { handler, error, json, requireAdmin } from "@/lib/api";
import { clientIp } from "@/lib/rateLimit";
import * as repo from "@/lib/repo";
import { gameManager } from "@/server/gameManager";

// Approve → atomically claim the pending request FIRST (so it can only be
// applied once), then push the chips to the player's table stack; on failure
// the claim is reverted back to pending.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const { status } = await req.json();
    const request = await repo.getTopup(id);
    if (!request || request.status !== "pending") return error("درخواست یافت نشد", 404);

    if (status === "approved") {
      // Claim the request FIRST so it can only be applied once. If applying the
      // chips then fails, revert the claim back to pending.
      const claimed = await repo.decideTopup(id, "approved", admin.sub);
      if (!claimed) return error("این درخواست قبلاً رسیدگی شده است", 409);
      try {
        await gameManager.topUp(request.table_id, request.user_id, Number(request.amount));
      } catch (err) {
        await repo.reopenTopup(id);
        return error((err as Error).message ?? "اعمال تاپ‌آپ ناموفق بود");
      }
    } else {
      await repo.decideTopup(id, "rejected", admin.sub);
    }
    await repo.writeAudit({
      correlationId: randomUUID(), actorId: admin.sub,
      action: status === "approved" ? "admin.topup_approve" : "admin.topup_reject",
      targetType: "topup", targetId: id,
      metadata: { userId: request.user_id, tableId: request.table_id, amount: Number(request.amount) },
      ip: clientIp(req),
    });
    return json({ ok: true });
  });
}
