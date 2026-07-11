import { handler, error, json, requireSession, isUuid } from "@/lib/api";
import * as repo from "@/lib/repo";

// List the ids the current user has blocked.
export async function GET() {
  return handler(async () => {
    const session = await requireSession();
    return json({ blocked: await repo.listBlockedIds(session.sub) });
  });
}

// Block a user.
export async function POST(req: Request) {
  return handler(async () => {
    const session = await requireSession();
    const { userId } = await req.json();
    if (!isUuid(userId)) return error("کاربر نامعتبر است");
    if (userId === session.sub) return error("نمی‌توانید خودتان را بلاک کنید");
    if (!(await repo.getUserById(userId))) return error("کاربر یافت نشد", 404);
    await repo.blockUser(session.sub, userId);
    return json({ ok: true });
  });
}
