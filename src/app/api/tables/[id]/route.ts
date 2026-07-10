import { handler, error, json, requireSession, requireAdmin } from "@/lib/api";
import * as repo from "@/lib/repo";
import { gameManager } from "@/server/gameManager";
import { InvalidActionError } from "@/lib/poker/engine";
import type { TableConfig } from "@/lib/poker/types";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    await requireSession();
    const { id } = await params;
    const table = await repo.getTable(id);
    if (!table || table.status !== "open") return error("میز یافت نشد", 404);
    return json({ id: table.id, name: table.name, config: table.config });
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    await requireAdmin();
    const { id } = await params;
    const table = await repo.getTable(id);
    if (!table || table.status !== "open") return error("میز یافت نشد", 404);
    if (table.tournament_id) return error("میز تورنومنت قابل ویرایش نیست", 409);

    const body = await req.json();
    const cfg = table.config as TableConfig;
    const patch: Partial<TableConfig> = {};

    if (body.name != null) patch.name = String(body.name).trim() || cfg.name;
    if (body.smallBlind != null) patch.smallBlind = Number(body.smallBlind);
    if (body.bigBlind != null) patch.bigBlind = Number(body.bigBlind);
    if (body.minBuyIn != null) patch.minBuyIn = Number(body.minBuyIn);
    if (body.maxBuyIn != null) patch.maxBuyIn = Number(body.maxBuyIn);
    if (body.maxSeats != null) patch.maxSeats = Math.min(9, Math.max(2, Number(body.maxSeats)));
    if (body.thinkTimeSec != null) patch.thinkTimeSec = Math.min(120, Math.max(5, Number(body.thinkTimeSec)));
    if (body.ante != null) patch.ante = Math.max(0, Number(body.ante));
    if (body.rakePercent != null) patch.rakePercent = Math.min(20, Math.max(0, Number(body.rakePercent)));
    if (body.rakeCap != null) patch.rakeCap = Math.max(0, Number(body.rakeCap));

    try {
      await gameManager.updateTable(id, {
        name: body.name != null ? String(body.name).trim() : undefined,
        config: patch,
      });
    } catch (err) {
      if (err instanceof InvalidActionError) return error(err.message, 409);
      throw err;
    }
    return json({ ok: true });
  });
}
