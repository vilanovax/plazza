import { handler, json, requireSession } from "@/lib/api";
import * as repo from "@/lib/repo";
import { tournamentManager } from "@/server/tournamentManager";
import { buildTableBanner } from "@/lib/tournament/tableBanner";

// Live tournament summary for the table view (null if the table isn't one).
export async function GET(_req: Request, { params }: { params: Promise<{ tableId: string }> }) {
  return handler(async () => {
    const session = await requireSession();
    const { tableId } = await params;
    const t = await repo.getTournamentByTable(tableId);
    if (!t) return json({ tournament: null });

    const entries = await repo.listEntries(t.id);
    return json({
      tournament: buildTableBanner(t, entries, session.sub, tournamentManager.lateRegOpen(t)),
    });
  });
}
