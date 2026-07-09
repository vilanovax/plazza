import { handler, error, json, requireAdmin } from "@/lib/api";
import * as repo from "@/lib/repo";
import type { AdminSettings } from "@/lib/models";

// Safe upper bounds keep timer math well within setTimeout's 32-bit limit.
const MAX_MINUTES = 1440; // 24h
const MAX_SECONDS = 3600; // 1h
const BIG = 1_000_000_000;

// field -> [min, max]
const NUMERIC_RANGES: Partial<Record<keyof AdminSettings, [number, number]>> = {
  default_small_blind: [0, BIG],
  default_big_blind: [0, BIG],
  default_rake_percent: [0, 20],
  default_rake_cap: [0, BIG],
  default_think_time_sec: [3, MAX_SECONDS],
  default_min_buyin: [0, BIG],
  default_max_buyin: [0, BIG],
  topup_min: [0, BIG],
  topup_max: [0, BIG],
  sit_out_max_min: [0, MAX_MINUTES],
  extra_time_sec: [0, MAX_SECONDS],
};
const BOOL: (keyof AdminSettings)[] = ["allow_self_topup", "allow_self_register"];

export async function GET() {
  return handler(async () => {
    await requireAdmin();
    return json({ settings: await repo.getSettings() });
  });
}

export async function PUT(req: Request) {
  return handler(async () => {
    await requireAdmin();
    const body = await req.json();
    const patch: Partial<AdminSettings> = {};

    for (const [k, [min, max]] of Object.entries(NUMERIC_RANGES)) {
      if (!(k in body)) continue;
      const n = Number(body[k]);
      if (!Number.isFinite(n)) return error(`مقدار «${k}» نامعتبر است`);
      (patch as Record<string, number>)[k] = Math.min(max, Math.max(min, Math.floor(n)));
    }

    if ("extra_time_requests" in body) {
      const n = Number(body.extra_time_requests);
      // -1 = unlimited, 0 = off, otherwise a positive cap. Reject anything else.
      if (!Number.isInteger(n) || n < -1) return error("تعداد درخواست زمان اضافه نامعتبر است");
      (patch as Record<string, number>).extra_time_requests = Math.min(BIG, n);
    }

    for (const k of BOOL) if (k in body) (patch as Record<string, boolean>)[k] = Boolean(body[k]);

    const settings = await repo.updateSettings(patch);
    return json({ settings });
  });
}
