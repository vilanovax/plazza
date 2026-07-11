import { handler, error, json, requireSession, isUuid } from "@/lib/api";
import { rateLimit } from "@/lib/rateLimit";
import * as repo from "@/lib/repo";

const REASON_MAX = 300;

// A player reports another player for admin moderation review.
export async function POST(req: Request) {
  return handler(async () => {
    const session = await requireSession();
    const { userId, reason, tableId } = await req.json();
    if (!isUuid(userId)) return error("کاربر نامعتبر است");
    if (userId === session.sub) return error("نمی‌توانید خودتان را گزارش کنید");
    const reasonText = String(reason ?? "").trim().slice(0, REASON_MAX);
    if (!reasonText) return error("علت گزارش لازم است");

    // Throttle report spam: 5 reports / hour per reporter. Keyed on the account
    // (session.sub) — NOT the IP — so switching IPs can't bypass the cap.
    const gate = rateLimit(`report:${session.sub}`, 5, 60 * 60 * 1000);
    if (!gate.ok) return error(`گزارش‌های زیاد؛ ${gate.retryAfter} ثانیه بعد دوباره تلاش کنید`, 429);

    if (!(await repo.getUserById(userId))) return error("کاربر یافت نشد", 404);
    await repo.createReport({
      reporterId: session.sub,
      reportedId: userId,
      reason: reasonText,
      // Only accept a well-formed table id; anything else is dropped (not 500).
      tableId: isUuid(tableId) ? tableId : null,
    });
    return json({ ok: true });
  });
}
