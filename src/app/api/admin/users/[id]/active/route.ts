import { handler, json, requireAdmin } from "@/lib/api";
import * as repo from "@/lib/repo";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    await requireAdmin();
    const { id } = await params;
    const { active } = await req.json();
    await repo.setUserActive(id, Boolean(active));
    return json({ ok: true });
  });
}
