import { NextResponse } from "next/server";
import { query } from "@/lib/db";

/** Liveness/readiness probe for load balancers and Docker healthchecks. */
export async function GET() {
  try {
    await query("SELECT 1 AS ok");
    return NextResponse.json({ ok: true, db: "ok" });
  } catch (err) {
    console.error("Health check failed:", err);
    return NextResponse.json({ ok: false, db: "error" }, { status: 503 });
  }
}
