import { handler, error, json, requireSession } from "@/lib/api";
import * as repo from "@/lib/repo";
import { buildTournamentDetail } from "@/lib/tournament/detail";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const session = await requireSession();
    const { id } = await params;
    const t = await repo.getTournament(id);
    if (!t) return error("تورنومنت یافت نشد", 404);
    const entries = await repo.listEntries(id);
    const users = await repo.getUsersByIds(entries.map((e) => e.user_id));
    const names = new Map(users.map((u) => [u.id, u.display_name]));
    return json(buildTournamentDetail(t, entries, names, session.sub, session.role));
  });
}
