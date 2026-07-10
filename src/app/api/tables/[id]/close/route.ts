import { handler, error, json, requireAdmin } from "@/lib/api";
import * as repo from "@/lib/repo";
import { gameManager } from "@/server/gameManager";
import { InvalidActionError } from "@/lib/poker/engine";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    await requireAdmin();
    const { id } = await params;
    const table = await repo.getTable(id);
    if (!table || table.status !== "open") return error("میز یافت نشد", 404);
    if (table.tournament_id) {
      return error("این میز متعلق به یک تورنومنت در حال اجراست و از تب «تورنومنت‌ها» بسته می‌شود", 409);
    }
    // Cash players out + stop the live runtime before hiding the table.
    try {
      await gameManager.closeTable(id);
    } catch (err) {
      if (err instanceof InvalidActionError) return error(err.message, 409);
      throw err;
    }
    await repo.closeTable(id);
    return json({ ok: true });
  });
}
