import { randomUUID } from "node:crypto";
import { handler, error, json, requireAdmin } from "@/lib/api";
import { clientIp } from "@/lib/rateLimit";
import * as repo from "@/lib/repo";

// Admin resolves a report as reviewed (actioned) or dismissed.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const { status } = await req.json();
    if (status !== "reviewed" && status !== "dismissed") return error("وضعیت نامعتبر است");
    const ok = await repo.resolveReport(id, status, admin.sub);
    if (!ok) return error("گزارش یافت نشد یا قبلاً رسیدگی شده است", 409);
    await repo.writeAudit({
      correlationId: randomUUID(), actorId: admin.sub, action: "admin.report_resolve",
      targetType: "report", targetId: id, metadata: { status }, ip: clientIp(req),
    });
    return json({ ok: true });
  });
}
