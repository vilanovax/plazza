import { handler, json, requireAdmin } from "@/lib/api";
import * as repo from "@/lib/repo";

// Net unsettled chip position per player: positive = up, negative = down.
export async function GET() {
  return handler(async () => {
    await requireAdmin();
    const rows = await repo.unsettledSummary();
    return json({
      settlements: rows.map((r) => ({
        userId: r.user_id,
        username: r.username,
        displayName: r.display_name,
        net: Number(r.net),
      })),
    });
  });
}
