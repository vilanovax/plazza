import { handler, error, json, requireSession } from "@/lib/api";
import * as repo from "@/lib/repo";
import { tournamentManager } from "@/server/tournamentManager";

/** Parse a BIGINT-ish value (string | number | bigint) to BigInt, or null if invalid. */
function toBigInt(v: unknown): bigint | null {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return Number.isInteger(v) ? BigInt(v) : null;
    if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
    return null;
  } catch {
    return null;
  }
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const session = await requireSession();
    const { id } = await params;
    const t = await repo.getTournament(id);
    if (!t) return error("تورنومنت یافت نشد", 404);
    // Open either to a scheduled tournament, or to a running one still inside its
    // late-registration window.
    const late = t.status === "running" && tournamentManager.lateRegOpen(t);
    if (t.status !== "scheduled" && !late) return error("ثبت‌نام این تورنومنت بسته است");

    const entries = await repo.listEntries(id);
    if (entries.some((e) => e.user_id === session.sub)) return error("قبلاً ثبت‌نام کرده‌اید", 409);
    if (!late && entries.length >= t.max_players) return error("ظرفیت تورنومنت تکمیل است");

    const user = await repo.getUserById(session.sub);
    // chip_balance / buy_in_chips are BIGINT (pg returns them as strings).
    // Compare with BigInt so a balance above Number.MAX_SAFE_INTEGER can't round
    // and slip past the funds check; a malformed value fails the guard.
    const balance = toBigInt(user?.chip_balance);
    const cost = toBigInt(t.buy_in_chips);
    if (!user || balance === null || cost === null || balance < cost) {
      return error("موجودی ژتون برای ثبت‌نام کافی نیست");
    }

    if (late) {
      await tournamentManager.lateRegister(id, session.sub);
    } else {
      await repo.buyIntoTournament(id, session.sub, Number(t.buy_in_chips), false);
    }
    return json({ ok: true });
  });
}
