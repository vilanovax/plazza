import { handler, error, json, requireSession } from "@/lib/api";
import * as repo from "@/lib/repo";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const session = await requireSession();
    const { id } = await params;
    const t = await repo.getTournament(id);
    if (!t) return error("تورنومنت یافت نشد", 404);
    if (t.status !== "scheduled") return error("ثبت‌نام این تورنومنت بسته است");

    const entries = await repo.listEntries(id);
    if (entries.some((e) => e.user_id === session.sub)) return error("قبلاً ثبت‌نام کرده‌اید", 409);
    if (entries.length >= t.max_players) return error("ظرفیت تورنومنت تکمیل است");

    const user = await repo.getUserById(session.sub);
    // pg can return BIGINT columns as strings — coerce both sides so this is a
    // numeric comparison, not a lexicographic one.
    if (!user || Number(user.chip_balance) < Number(t.buy_in_chips)) {
      return error("موجودی ژتون برای ثبت‌نام کافی نیست");
    }

    await repo.buyIntoTournament(id, session.sub, Number(t.buy_in_chips), false);
    return json({ ok: true });
  });
}
