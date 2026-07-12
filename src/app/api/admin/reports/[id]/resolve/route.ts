import { randomUUID } from "node:crypto";
import { handler, error, json, requireAdmin } from "@/lib/api";
import { clientIp } from "@/lib/rateLimit";
import { tx } from "@/lib/db";
import * as repo from "@/lib/repo";

// Admin resolves a report as reviewed (actioned) or dismissed.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const { status } = await req.json();
    if (status !== "reviewed" && status !== "dismissed") return error("وضعیت نامعتبر است");
    const ip = clientIp(req);
    // Resolve the report and write its audit record in ONE transaction so the
    // moderation state can't commit without its audit trail (or vice versa).
    const ok = await tx(async (client) => {
      const resolved = await repo.resolveReportTx(client, id, status, admin.sub);
      if (!resolved) return false;
      await repo.writeAuditTx(client, {
        correlationId: randomUUID(), actorId: admin.sub, action: "admin.report_resolve",
        targetType: "report", targetId: id, metadata: { status }, ip,
      });
      return true;
    });
    if (!ok) return error("گزارش یافت نشد یا قبلاً رسیدگی شده است", 409);
    return json({ ok: true });
  });
}
