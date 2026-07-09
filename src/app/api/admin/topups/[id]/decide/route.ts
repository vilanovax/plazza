import { handler, error, json, requireAdmin } from "@/lib/api";
import * as repo from "@/lib/repo";
import { gameManager } from "@/server/gameManager";

// Approve → apply the chips to the player's table stack, then mark approved.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const { status } = await req.json();
    const request = await repo.getTopup(id);
    if (!request || request.status !== "pending") return error("درخواست یافت نشد", 404);

    if (status === "approved") {
      try {
        await gameManager.topUp(request.table_id, request.user_id, Number(request.amount));
      } catch (err) {
        return error((err as Error).message ?? "اعمال تاپ‌آپ ناموفق بود");
      }
      await repo.decideTopup(id, "approved", admin.sub);
    } else {
      await repo.decideTopup(id, "rejected", admin.sub);
    }
    return json({ ok: true });
  });
}
