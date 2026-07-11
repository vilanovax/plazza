import { handler, json, requireAdmin } from "@/lib/api";
import * as repo from "@/lib/repo";

// List player reports for moderation (optionally filtered by ?status=).
export async function GET(req: Request) {
  return handler(async () => {
    await requireAdmin();
    const status = new URL(req.url).searchParams.get("status");
    const valid = status === "open" || status === "reviewed" || status === "dismissed" ? status : null;
    return json({ reports: await repo.listReports(valid) });
  });
}
