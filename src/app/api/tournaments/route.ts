import { handler, error, json, requireSession, requireAdmin } from "@/lib/api";
import * as repo from "@/lib/repo";
import {
  defaultBlindSchedule,
  defaultPayouts,
  PAYOUT_PRESETS,
  playableLevel,
  validatePayouts,
  type TournamentConfig,
} from "@/lib/tournament/types";

export async function GET() {
  return handler(async () => {
    const session = await requireSession();
    const [tournaments, myIds] = await Promise.all([
      repo.listTournamentsWithCounts(),
      repo.getUserTournamentIds(session.sub),
    ]);
    const registered = new Set(myIds);
    const withCounts = tournaments.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      buyInChips: Number(t.buy_in_chips),
      startingStack: Number(t.starting_stack),
      maxPlayers: t.max_players,
      registered: t.registered,
      prizePool: Number(t.prize_pool),
      payouts: t.config.payouts,
      // Late registration still open? Lets the lobby show a join button for a
      // running tournament inside its window.
      lateRegOpen:
        t.status === "running" &&
        (t.config.lateRegThroughLevel ?? 0) > 0 &&
        playableLevel(t.blind_schedule, t.current_level) <= (t.config.lateRegThroughLevel ?? 0),
      registeredByMe: registered.has(t.id),
    }));
    return json({ tournaments: withCounts });
  });
}

export async function POST(req: Request) {
  return handler(async () => {
    const session = await requireAdmin();
    const b = await req.json();

    // Reject non-numeric / NaN / Infinity inputs outright rather than letting
    // Number() coerce them into a clamp (e.g. Number("abc") -> NaN -> clamp).
    const num = (v: unknown, fallback: number): number | null => {
      if (v == null) return fallback;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const fields = {
      maxPlayers: num(b.maxPlayers, 6),
      buyInChips: num(b.buyInChips, 1000),
      startingStack: num(b.startingStack, 1500),
      startBb: num(b.startBigBlind, 20),
      levelMinutes: num(b.levelMinutes, 10),
      levels: num(b.levels, 15),
    };
    if (Object.values(fields).some((v) => v === null)) return error("مقادیر عددی نامعتبر است");

    const maxPlayers = Math.min(9, Math.max(2, Math.floor(fields.maxPlayers as number)));
    const buyInChips = Math.max(0, Math.floor(fields.buyInChips as number));
    const startingStack = Math.max(1, Math.floor(fields.startingStack as number));
    const startBb = Math.max(2, Math.floor(fields.startBb as number));
    const levelMinutes = Math.max(1, Math.floor(fields.levelMinutes as number));
    const levels = Math.min(30, Math.max(3, Math.floor(fields.levels as number)));

    // Payouts: an explicit array, a named preset, or a field-size default.
    let payouts: number[];
    if (Array.isArray(b.payouts)) payouts = b.payouts.map((n: unknown) => Math.floor(Number(n)));
    else if (b.payoutPreset && PAYOUT_PRESETS[b.payoutPreset]) payouts = PAYOUT_PRESETS[b.payoutPreset];
    else payouts = defaultPayouts(maxPlayers);
    if (!validatePayouts(payouts)) return error("درصد جوایز باید مجموعاً ۱۰۰ و نزولی باشد");
    if (payouts.length > maxPlayers) return error("تعداد رتبه‌های جایزه بیش از تعداد بازیکنان است");

    const rebuyMaxCount = num(b.rebuyMaxCount, -1);
    const rebuyThroughLevel = num(b.rebuyThroughLevel, 4);
    const lateRegThroughLevel = num(b.lateRegThroughLevel, 0);
    const breakEveryLevels = num(b.breakEveryLevels, 0);
    const breakMinutes = num(b.breakMinutes, 5);
    if (rebuyMaxCount === null || rebuyThroughLevel === null) return error("مقادیر ری‌بای نامعتبر است");
    if (lateRegThroughLevel === null || breakEveryLevels === null || breakMinutes === null) {
      return error("مقادیر ثبت‌نام با تأخیر/استراحت نامعتبر است");
    }

    const config: TournamentConfig = {
      rebuyAllowed: b.rebuyAllowed === true || b.rebuyAllowed == null,
      rebuyMaxCount: Math.max(-1, Math.floor(rebuyMaxCount)),
      rebuyThroughLevel: Math.max(0, Math.floor(rebuyThroughLevel)),
      payouts,
      lateRegThroughLevel: Math.min(levels, Math.max(0, Math.floor(lateRegThroughLevel))),
      breakEveryLevels: Math.max(0, Math.floor(breakEveryLevels)),
      breakMinutes: Math.min(60, Math.max(1, Math.floor(breakMinutes))),
    };

    const t = await repo.createTournament({
      name: String(b.name || "تورنومنت"),
      buyInChips,
      startingStack,
      maxPlayers,
      blindSchedule: defaultBlindSchedule(startBb, levels, levelMinutes, config.breakEveryLevels, config.breakMinutes),
      config,
      createdBy: session.sub,
    });
    return json({ id: t.id });
  });
}
