import { handler, json, requireAdmin } from "@/lib/api";
import * as repo from "@/lib/repo";

// Admin marks a ledger entry as settled (real-world balances squared up).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const { settled } = await req.json();
    await repo.setLedgerSettled(id, Boolean(settled), admin.sub);
    return json({ ok: true });
  });
}
