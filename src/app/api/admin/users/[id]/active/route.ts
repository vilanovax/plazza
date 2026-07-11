import { randomUUID } from "node:crypto";
import { handler, json, requireAdmin } from "@/lib/api";
import { clientIp } from "@/lib/rateLimit";
import * as repo from "@/lib/repo";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const { active } = await req.json();
    // Strict check: a JSON string "false" must not be treated as truthy.
    const isActive = active === true || active === "true";
    await repo.setUserActive(id, isActive);
    await repo.writeAudit({
      correlationId: randomUUID(), actorId: admin.sub, action: "admin.user_active",
      targetType: "user", targetId: id, metadata: { active: isActive }, ip: clientIp(req),
    });
    return json({ ok: true });
  });
}
