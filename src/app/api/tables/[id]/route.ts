import { handler, error, json, requireSession } from "@/lib/api";
import * as repo from "@/lib/repo";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    await requireSession();
    const { id } = await params;
    const table = await repo.getTable(id);
    if (!table || table.status !== "open") return error("میز یافت نشد", 404);
    return json({ id: table.id, name: table.name, config: table.config });
  });
}
