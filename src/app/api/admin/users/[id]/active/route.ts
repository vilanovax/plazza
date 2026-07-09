import { handler, json, requireAdmin } from "@/lib/api";
import * as repo from "@/lib/repo";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    await requireAdmin();
    const { id } = await params;
    const { active } = await req.json();
    // Strict check: a JSON string "false" must not be treated as truthy.
    await repo.setUserActive(id, active === true || active === "true");
    return json({ ok: true });
  });
}
