import { handler, error, json, requireAdmin } from "@/lib/api";
import { tournamentManager } from "@/server/tournamentManager";
import { InvalidActionError } from "@/lib/poker/engine";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    try {
      await tournamentManager.start(id, admin.sub);
    } catch (err) {
      if (err instanceof InvalidActionError) return error(err.message, 409);
      throw err;
    }
    return json({ ok: true });
  });
}
