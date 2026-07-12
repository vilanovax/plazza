import { query } from "@/lib/db";
import { json } from "@/lib/api";

/** Liveness/readiness probe for load balancers and Docker healthchecks.
 *  Never cache: a stale "ok" (or worse, a cached 503) would mislead probes. */
export async function GET() {
  try {
    await query("SELECT 1 AS ok");
    return json({ ok: true, db: "ok" });
  } catch (err) {
    console.error("Health check failed:", err);
    return json({ ok: false, db: "error" }, 503);
  }
}
