import { randomUUID } from "node:crypto";
import { handler, error, json, requireAdmin } from "@/lib/api";
import { clientIp } from "@/lib/rateLimit";
import * as repo from "@/lib/repo";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const { active } = await req.json();
    // Strict check: a JSON string "false" must not be treated as truthy.
    const isActive = active === true || active === "true";
    // Only audit a real state change: setUserActive reports whether a row was
    // updated, so a bogus/nonexistent id 404s instead of logging a phantom event.
    const updated = await repo.setUserActive(id, isActive);
    if (!updated) return error("کاربر یافت نشد", 404);
    await repo.writeAudit({
      correlationId: randomUUID(), actorId: admin.sub, action: "admin.user_active",
      targetType: "user", targetId: id, metadata: { active: isActive }, ip: clientIp(req),
    });
    return json({ ok: true });
  });
}
