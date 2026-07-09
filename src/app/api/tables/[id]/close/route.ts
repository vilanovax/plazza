import { handler, json, requireAdmin } from "@/lib/api";
import * as repo from "@/lib/repo";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    await requireAdmin();
    const { id } = await params;
    await repo.closeTable(id);
    return json({ ok: true });
  });
}
