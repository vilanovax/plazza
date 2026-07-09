import { handler, error, json, requireSession, requireAdmin } from "@/lib/api";
import * as repo from "@/lib/repo";
import type { TableConfig } from "@/lib/poker/types";

// List open tables with live seat counts.
export async function GET() {
  return handler(async () => {
    await requireSession();
    const tables = await repo.listOpenTables();
    const withCounts = await Promise.all(
      tables.map(async (t) => {
        const seats = await repo.listSeats(t.id);
        return {
          id: t.id,
          name: t.name,
          config: t.config,
          seated: seats.filter((s) => s.user_id).length,
          maxSeats: t.config.maxSeats,
        };
      })
    );
    return json({ tables: withCounts });
  });
}

// Create a table (admin only).
export async function POST(req: Request) {
  return handler(async () => {
    const session = await requireAdmin();
    const body = await req.json();
    const s = await repo.getSettings();

    const bb = Number(body.bigBlind ?? s.default_big_blind);
    const sb = Number(body.smallBlind ?? s.default_small_blind);
    if (!Number.isFinite(sb) || !Number.isFinite(bb) || sb <= 0 || bb <= 0 || sb > bb) {
      return error("مقادیر بلایند نامعتبر است");
    }

    const config: TableConfig = {
      name: String(body.name || "میز جدید"),
      maxSeats: Math.min(9, Math.max(2, Number(body.maxSeats ?? 6))),
      smallBlind: sb,
      bigBlind: bb,
      ante: Math.max(0, Number(body.ante ?? 0)),
      rakePercent: Math.min(20, Math.max(0, Number(body.rakePercent ?? s.default_rake_percent))),
      rakeCap: Math.max(0, Number(body.rakeCap ?? s.default_rake_cap)),
      noFlopNoDrop: body.noFlopNoDrop ?? true,
      minBuyIn: Math.max(bb, Number(body.minBuyIn ?? s.default_min_buyin)),
      maxBuyIn: Math.max(
        Math.max(bb, Number(body.minBuyIn ?? s.default_min_buyin)),
        Number(body.maxBuyIn ?? s.default_max_buyin)
      ),
      thinkTimeSec: Math.min(120, Math.max(5, Number(body.thinkTimeSec ?? s.default_think_time_sec))),
      allowTopUp: body.allowTopUp ?? true,
      topUpMin: Math.max(0, Number(body.topUpMin ?? s.topup_min)),
      topUpMax: Math.max(0, Number(body.topUpMax ?? s.topup_max)),
      tableDurationMin: Math.max(0, Number(body.tableDurationMin ?? 0)),
      sitOutMaxMin: Math.max(0, Number(body.sitOutMaxMin ?? s.sit_out_max_min)),
      extraTimeSec: Math.max(0, Number(body.extraTimeSec ?? s.extra_time_sec)),
      extraTimeRequests: Math.max(-1, Math.floor(Number(body.extraTimeRequests ?? s.extra_time_requests))),
    };
    const table = await repo.createTable(config.name, config, session.sub);
    return json({ id: table.id });
  });
}
