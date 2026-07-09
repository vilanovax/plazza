import { handler, json, requireAdmin } from "@/lib/api";
import * as repo from "@/lib/repo";
import type { AdminSettings } from "@/lib/models";

const NUMERIC: (keyof AdminSettings)[] = [
  "default_small_blind",
  "default_big_blind",
  "default_rake_percent",
  "default_rake_cap",
  "default_think_time_sec",
  "default_min_buyin",
  "default_max_buyin",
  "topup_min",
  "topup_max",
];
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
    for (const k of NUMERIC) if (k in body) (patch as Record<string, number>)[k] = Math.max(0, Math.floor(Number(body[k])));
    for (const k of BOOL) if (k in body) (patch as Record<string, boolean>)[k] = Boolean(body[k]);
    const settings = await repo.updateSettings(patch);
    return json({ settings });
  });
}
