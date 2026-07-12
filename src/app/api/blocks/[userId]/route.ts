import { handler, json, requireSession } from "@/lib/api";
import * as repo from "@/lib/repo";

// Unblock a user.
export async function DELETE(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  return handler(async () => {
    const session = await requireSession();
    const { userId } = await params;
    await repo.unblockUser(session.sub, userId);
    return json({ ok: true });
  });
}
