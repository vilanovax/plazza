import { handler, error, json, requireSession, requireAdmin } from "@/lib/api";
import * as repo from "@/lib/repo";
import {
  defaultBlindSchedule,
  defaultPayouts,
  PAYOUT_PRESETS,
  validatePayouts,
  type TournamentConfig,
} from "@/lib/tournament/types";

export async function GET() {
  return handler(async () => {
    await requireSession();
    const tournaments = await repo.listTournaments();
    const withCounts = await Promise.all(
      tournaments.map(async (t) => {
        const entries = await repo.listEntries(t.id);
        return {
          id: t.id,
          name: t.name,
          status: t.status,
          buyInChips: Number(t.buy_in_chips),
          startingStack: Number(t.starting_stack),
          maxPlayers: t.max_players,
          registered: entries.length,
          prizePool: Number(t.prize_pool),
          payouts: t.config.payouts,
        };
      })
    );
    return json({ tournaments: withCounts });
  });
}

export async function POST(req: Request) {
  return handler(async () => {
    const session = await requireAdmin();
    const b = await req.json();

    const maxPlayers = Math.min(9, Math.max(2, Number(b.maxPlayers ?? 6)));
    const buyInChips = Math.max(0, Math.floor(Number(b.buyInChips ?? 1000)));
    const startingStack = Math.max(1, Math.floor(Number(b.startingStack ?? 1500)));
    const startBb = Math.max(2, Math.floor(Number(b.startBigBlind ?? 20)));
    const levelMinutes = Math.max(1, Math.floor(Number(b.levelMinutes ?? 10)));
    const levels = Math.min(30, Math.max(3, Math.floor(Number(b.levels ?? 15))));

    // Payouts: an explicit array, a named preset, or a field-size default.
    let payouts: number[];
    if (Array.isArray(b.payouts)) payouts = b.payouts.map((n: unknown) => Math.floor(Number(n)));
    else if (b.payoutPreset && PAYOUT_PRESETS[b.payoutPreset]) payouts = PAYOUT_PRESETS[b.payoutPreset];
    else payouts = defaultPayouts(maxPlayers);
    if (!validatePayouts(payouts)) return error("درصد جوایز باید مجموعاً ۱۰۰ باشد");
    if (payouts.length > maxPlayers) return error("تعداد رتبه‌های جایزه بیش از تعداد بازیکنان است");

    const config: TournamentConfig = {
      rebuyAllowed: b.rebuyAllowed ?? true,
      rebuyMaxCount: b.rebuyMaxCount == null ? -1 : Math.max(-1, Math.floor(Number(b.rebuyMaxCount))),
      rebuyThroughLevel: Math.max(0, Math.floor(Number(b.rebuyThroughLevel ?? 4))),
      payouts,
    };

    const t = await repo.createTournament({
      name: String(b.name || "تورنومنت"),
      buyInChips,
      startingStack,
      maxPlayers,
      blindSchedule: defaultBlindSchedule(startBb, levels, levelMinutes),
      config,
      createdBy: session.sub,
    });
    return json({ id: t.id });
  });
}
